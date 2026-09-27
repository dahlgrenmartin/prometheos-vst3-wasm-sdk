#include <webvst/webvst.h>

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {
void require_at (bool condition, int line) {
  if (!condition) {
    std::fprintf (stderr, "upstream ADelay requirement failed at line %d\n", line);
    std::abort ();
  }
}
#define require(condition) require_at ((condition), __LINE__)

template <typename Size, typename Write>
std::vector<char> read_text (Size size, Write write) {
  std::vector<char> result (size () + 1, '\0');
  require (write (result.data (), static_cast<uint32_t> (result.size () - 1)) == WEBVST_OK);
  return result;
}

void factory_is_discovered_through_the_generic_adapter () {
  require (webvst_class_count () == 1);
  const auto name = read_text ([] { return webvst_class_name_size (0); },
                               [] (char* dst, uint32_t size) { return webvst_class_name_write (0, dst, size); });
  const auto vendor = read_text ([] { return webvst_class_vendor_size (0); },
                                 [] (char* dst, uint32_t size) { return webvst_class_vendor_write (0, dst, size); });
  require (std::strcmp (name.data (), "ADelay") == 0);
  require (std::strcmp (vendor.data (), "Steinberg Media Technologies") == 0);
  require (webvst_class_kind (0) == 0);
}

void effect_processes_audio_and_round_trips_vst3_state () {
  constexpr uint32_t frames = 4;
  std::array<float, frames * 2> input {1.f, -1.f};
  std::array<float, frames * 2> output {};
  const auto first = webvst_create (0, 48000., frames);
  const auto second = webvst_create (0, 48000., frames);
  require (first != 0 && second != 0);

  require (webvst_class_param_count (0) == 2);
  require (webvst_param_set (first, 100, 0.f) == WEBVST_OK);
  require (webvst_process (first, input.data (), output.data (), frames) == WEBVST_OK);
  require (std::fabs (output[0]) < 0.0001f);
  require (std::fabs (output[1]) < 0.0001f);
  require (std::fabs (output[2] - 1.f) < 0.0001f);
  require (std::fabs (output[3] + 1.f) < 0.0001f);

  require (webvst_param_set (first, 100, .25f) == WEBVST_OK);
  require (webvst_process (first, input.data (), output.data (), frames) == WEBVST_OK);
  const auto state_size = webvst_state_size (first);
  require (state_size > 0);
  std::vector<uint8_t> state (state_size);
  require (webvst_state_write (first, state.data (), state.size ()) == WEBVST_OK);
  require (webvst_state_load (second, state.data (), state.size ()) == WEBVST_OK);
  require (std::fabs (webvst_param_get (second, 100) - .25f) < 0.0001f);

  webvst_destroy (first);
  webvst_destroy (second);
}
} // namespace

int main () {
  factory_is_discovered_through_the_generic_adapter ();
  effect_processes_audio_and_round_trips_vst3_state ();
  return 0;
}
