#include <prometheos/webvst.h>

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {
void require_at (bool condition, int line) {
  if (!condition) {
    std::fprintf (stderr, "actual VST3 fixture requirement failed at line %d\n", line);
    std::abort ();
  }
}
#define require(condition) require_at ((condition), __LINE__)

std::array<char, 33> class_uid (uint32_t class_index) {
  std::array<char, 33> result {};
  require (pvst_class_uid_size (class_index) == result.size () - 1);
  require (pvst_class_uid_write (class_index, result.data (), result.size () - 1) == PVST_OK);
  return result;
}

bool has_signal (const std::array<float, 256>& samples) {
  for (const auto sample : samples)
    if (std::fabs (sample) > 0.0001f) return true;
  return false;
}

void actual_vst3_factory_exposes_two_canonical_audio_classes () {
  require (pvst_class_count () == 2);
  require (std::strcmp (class_uid (0).data (), "101112131415161718191a1b1c1d1e1f") == 0);
  require (std::strcmp (class_uid (1).data (), "202122232425262728292a2b2c2d2e2f") == 0);
  require (std::strcmp (class_uid (0).data (), class_uid (1).data ()) != 0);
}

void instrument_generates_audio_after_a_vst3_note_event () {
  std::array<float, 256> output {};
  const auto instrument = pvst_create (0, 48000., 128);
  require (instrument != 0);
  require (pvst_note_on (instrument, 69, 1.f) == PVST_OK);
  require (pvst_process (instrument, nullptr, output.data (), 128) == PVST_OK);
  require (has_signal (output));
  pvst_destroy (instrument);
}

void effect_applies_its_gain_to_both_stereo_channels () {
  std::array<float, 256> input {};
  std::array<float, 256> output {};
  for (uint32_t frame = 0; frame < 128; ++frame) {
    input[frame * 2] = .25f;
    input[frame * 2 + 1] = -.5f;
  }
  const auto effect = pvst_create (1, 48000., 128);
  require (effect != 0);
  require (pvst_param_set (effect, 0x2001, .5f) == PVST_OK);
  require (pvst_process (effect, input.data (), output.data (), 128) == PVST_OK);
  require (output[0] == .125f);
  require (output[1] == -.25f);
  pvst_destroy (effect);
}

void effect_applies_gain_when_interleaved_input_and_output_alias () {
  std::array<float, 256> interleaved {};
  for (uint32_t frame = 0; frame < 128; ++frame) {
    interleaved[frame * 2] = .25f;
    interleaved[frame * 2 + 1] = -.5f;
  }
  const auto effect = pvst_create (1, 48000., 128);
  require (effect != 0);
  require (pvst_param_set (effect, 0x2001, .5f) == PVST_OK);
  require (pvst_process (effect, interleaved.data (), interleaved.data (), 128) == PVST_OK);
  require (interleaved[0] == .125f);
  require (interleaved[1] == -.25f);
  require (interleaved[254] == .125f);
  require (interleaved[255] == -.25f);
  pvst_destroy (effect);
}

void controllers_expose_stable_automatable_gain_parameters () {
  require (pvst_class_param_count (0) == 1);
  require (pvst_class_param_id (0, 0) == 0x1001);
  require ((pvst_class_param_flags (0, 0) & PVST_PARAMETER_AUTOMATABLE) != 0);
  require (pvst_class_param_step_count (0, 0) == 0);
  require (pvst_class_param_default (0, 0) == 1.f);
  require (pvst_class_param_count (1) == 1);
  require (pvst_class_param_id (1, 0) == 0x2001);
  require ((pvst_class_param_flags (1, 0) & PVST_PARAMETER_AUTOMATABLE) != 0);
  require (pvst_class_param_step_count (1, 0) == 0);
  require (pvst_class_param_default (1, 0) == .25f);
}

void instrument_parameter_state_restores_through_the_public_abi () {
  const auto first = pvst_create (0, 48000., 128);
  const auto second = pvst_create (0, 48000., 128);
  require (first != 0 && second != 0);
  require (pvst_param_set (first, 0x1001, .625f) == PVST_OK);
  const auto state_size = pvst_state_size (first);
  require (state_size > 0);
  std::vector<uint8_t> state (state_size);
  require (pvst_state_write (first, state.data (), state_size) == PVST_OK);
  require (pvst_state_load (second, state.data (), state_size) == PVST_OK);
  require (pvst_param_get (second, 0x1001) == .625f);
  pvst_destroy (first);
  pvst_destroy (second);
}
} // namespace

int main () {
  actual_vst3_factory_exposes_two_canonical_audio_classes ();
  instrument_generates_audio_after_a_vst3_note_event ();
  effect_applies_its_gain_to_both_stereo_channels ();
  effect_applies_gain_when_interleaved_input_and_output_alias ();
  controllers_expose_stable_automatable_gain_parameters ();
  instrument_parameter_state_restores_through_the_public_abi ();
  return 0;
}
