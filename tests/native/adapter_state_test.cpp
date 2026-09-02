#define WEBVST_DEFINE_FAKE_FACTORY
#include "fake_factory.h"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {
void require_at (bool condition, int line) { if (!condition) { std::fprintf (stderr, "state requirement failed at line %d\n", line); std::abort (); } }
#define require(condition) require_at ((condition), __LINE__)

uint32_t read_u32 (const unsigned char* bytes) {
  uint32_t result {};
  std::memcpy (&result, bytes, sizeof result);
  return result;
}

void write_u32 (unsigned char* bytes, uint32_t value) {
  std::memcpy (bytes, &value, sizeof value);
}

int state_call_count () {
  using fake_vst3::Call;
  return fake_vst3::failures.count (Call::ComponentStateLoad) +
         fake_vst3::failures.count (Call::ControllerComponentStateLoad) +
         fake_vst3::failures.count (Call::ControllerStateLoad);
}

void require_state_calls (std::initializer_list<fake_vst3::Call> expected) {
  require (fake_vst3::failures.call_count == expected.size ());
  size_t index = 0;
  for (const auto call : expected) require (fake_vst3::failures.calls[index++] == call);
}
} // namespace

int process_test ();
int lifecycle_test ();

int main () {
  fake_vst3::failures.reset ();
  fake_vst3::failures.combined_controller = true;
  const auto combined_source = webvst_create (0, 48000., 128);
  require (combined_source != 0);
  require (webvst_param_set (combined_source, fake_vst3::kGainId, .25f) == WEBVST_OK);
  const auto combined_size = webvst_state_size (combined_source);
  require (combined_size == 16 + sizeof (double));
  std::array<unsigned char, 256> combined_bytes {};
  require (webvst_state_write (combined_source, combined_bytes.data (), combined_size) == WEBVST_OK);
  require (read_u32 (combined_bytes.data () + 8) == sizeof (double));
  require (read_u32 (combined_bytes.data () + 12) == 0);

  const auto combined_target = webvst_create (0, 48000., 128);
  require (combined_target != 0);
  fake_vst3::failures.clear_calls ();
  require (webvst_state_load (combined_target, combined_bytes.data (), combined_size) == WEBVST_OK);
  require_state_calls ({fake_vst3::Call::ComponentStateLoad});
  require (webvst_param_get (combined_target, fake_vst3::kGainId) == .25f);
  auto combined_with_controller_payload = combined_bytes;
  write_u32 (combined_with_controller_payload.data () + 12, 1);
  fake_vst3::failures.clear_calls ();
  require (webvst_state_load (combined_target, combined_with_controller_payload.data (), combined_size + 1) == WEBVST_ERROR_ARGUMENT);
  require (state_call_count () == 0);
  webvst_destroy (combined_source);
  webvst_destroy (combined_target);
  require (fake_vst3::failures.live_objects == 0);

  lifecycle_test ();
  process_test ();

  fake_vst3::failures.reset ();
  const auto first = webvst_create (0, 48000., 128);
  require (first != 0);
  require (webvst_param_set (first, fake_vst3::kGainId, .75f) == WEBVST_OK);
  const auto size = webvst_state_size (first);
  require (size == 16 + sizeof (double) + sizeof (uint64_t) + sizeof (double));
  std::array<unsigned char, 256> bytes {};
  require (webvst_state_write (first, bytes.data (), size) == WEBVST_OK);
  require (read_u32 (bytes.data () + 8) == sizeof (double));
  require (read_u32 (bytes.data () + 12) == sizeof (uint64_t) + sizeof (double));

  const auto second = webvst_create (0, 48000., 128);
  require (second != 0);
  fake_vst3::failures.clear_calls ();
  require (webvst_state_load (second, bytes.data (), size) == WEBVST_OK);
  require_state_calls ({fake_vst3::Call::ComponentStateLoad,
                        fake_vst3::Call::ControllerComponentStateLoad,
                        fake_vst3::Call::ControllerStateLoad});
  require (webvst_param_get (second, fake_vst3::kGainId) == .75f);

  constexpr std::array state_failures {
    fake_vst3::FailurePoint::ComponentStateLoad,
    fake_vst3::FailurePoint::ControllerComponentStateLoad,
    fake_vst3::FailurePoint::ControllerStateLoad,
  };
  constexpr std::array state_calls {
    fake_vst3::Call::ComponentStateLoad,
    fake_vst3::Call::ControllerComponentStateLoad,
    fake_vst3::Call::ControllerStateLoad,
  };
  for (size_t failure_index = 0; failure_index < state_failures.size (); ++failure_index) {
    const auto failure = state_failures[failure_index];
    fake_vst3::failures.fail_at = failure;
    fake_vst3::failures.clear_calls ();
    require (webvst_state_load (second, bytes.data (), size) == WEBVST_ERROR_PLUGIN);
    require (state_call_count () == static_cast<int> (failure_index + 1));
    require (fake_vst3::failures.call_count == failure_index + 1);
    for (size_t call_index = 0; call_index <= failure_index; ++call_index)
      require (fake_vst3::failures.calls[call_index] == state_calls[call_index]);
  }
  fake_vst3::failures.fail_at = fake_vst3::FailurePoint::None;

  auto malformed = bytes;
  write_u32 (malformed.data () + 8, read_u32 (malformed.data () + 8) - 1);
  fake_vst3::failures.clear_calls ();
  require (webvst_state_load (second, malformed.data (), size) == WEBVST_ERROR_ARGUMENT);
  require (state_call_count () == 0);

  malformed = bytes;
  write_u32 (malformed.data () + 12, read_u32 (malformed.data () + 12) - 1);
  fake_vst3::failures.clear_calls ();
  require (webvst_state_load (second, malformed.data (), size) == WEBVST_ERROR_ARGUMENT);
  require (state_call_count () == 0);

  fake_vst3::failures.clear_calls ();
  require (webvst_state_load (second, bytes.data (), 3) == WEBVST_ERROR_ARGUMENT);
  require (state_call_count () == 0);

  webvst_destroy (first);
  webvst_destroy (second);

  require (fake_vst3::failures.live_objects == 0);
  return 0;
}
