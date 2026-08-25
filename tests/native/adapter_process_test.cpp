#include "fake_factory.h"

#include <array>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <new>

namespace allocation_probe {
bool enabled {};
size_t count {};
}

void* operator new (std::size_t size) {
  if (allocation_probe::enabled) ++allocation_probe::count;
  if (auto* value = std::malloc (size)) return value;
  throw std::bad_alloc ();
}
void* operator new[] (std::size_t size) { return ::operator new (size); }
void operator delete (void* value) noexcept { std::free (value); }
void operator delete[] (void* value) noexcept { std::free (value); }
void operator delete (void* value, std::size_t) noexcept { std::free (value); }
void operator delete[] (void* value, std::size_t) noexcept { std::free (value); }

namespace {
void require_at (bool condition, int line) { if (!condition) { std::fprintf (stderr, "process requirement failed at line %d\n", line); std::abort (); } }
#define require(condition) require_at ((condition), __LINE__)

void note_events_use_the_matching_union_and_support_callback_qi () {
  using namespace Steinberg::Vst;
  fake_vst3::failures.reset ();
  std::array<float, 256> output {};
  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  require (pvst_note_on (synth, 60, .5f) == PVST_OK);
  require (pvst_note_off (synth, 60) == PVST_OK);
  require (pvst_process (synth, nullptr, output.data (), 128) == PVST_OK);
  require (fake_vst3::failures.event_list_qi_ok);
  require (fake_vst3::failures.event_count == 2);
  const auto& on = fake_vst3::failures.events[0];
  require (on.type == Event::kNoteOnEvent);
  require (on.noteOn.pitch == 60);
  require (on.noteOn.velocity == .5f);
  require (on.noteOn.noteId == -1);
  const auto& off = fake_vst3::failures.events[1];
  require (off.type == Event::kNoteOffEvent);
  require (off.noteOff.pitch == 60);
  require (off.noteOff.velocity == 0.f);
  require (off.noteOff.noteId == -1);
  pvst_destroy (synth);
}

void parameter_points_are_grouped_by_id () {
  fake_vst3::failures.reset ();
  std::array<float, 2> output {};
  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  require (pvst_param_set (synth, fake_vst3::kGainId, .2f) == PVST_OK);
  require (pvst_param_set (synth, fake_vst3::kGainId, .4f) == PVST_OK);
  require (pvst_param_set (synth, fake_vst3::kMixId, .6f) == PVST_OK);
  require (pvst_process (synth, nullptr, output.data (), 1) == PVST_OK);
  require (fake_vst3::failures.parameter_changes_qi_ok);
  require (fake_vst3::failures.parameter_queue_qi_ok);
  require (fake_vst3::failures.parameter_queue_count == 2);
  require (fake_vst3::failures.parameter_point_count == 3);
  require (fake_vst3::failures.parameter_queues[0].id == fake_vst3::kGainId);
  require (fake_vst3::failures.parameter_queues[0].point_count == 2);
  require (fake_vst3::failures.parameter_queues[0].values[0] == .2f);
  require (fake_vst3::failures.parameter_queues[0].values[1] == .4f);
  require (fake_vst3::failures.parameter_queues[1].id == fake_vst3::kMixId);
  require (fake_vst3::failures.parameter_queues[1].point_count == 1);
  require (fake_vst3::failures.parameter_queues[1].values[0] == .6f);
  pvst_destroy (synth);
}

void the_sixty_fifth_parameter_point_is_atomic () {
  fake_vst3::failures.reset ();
  std::array<float, 2> output {};
  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  for (int point = 0; point < 64; ++point)
    require (pvst_param_set (synth, point % 2 == 0 ? fake_vst3::kGainId : fake_vst3::kMixId, static_cast<float> (point) / 64.f) == PVST_OK);
  const auto last_gain = 62.f / 64.f;
  require (fake_vst3::failures.controller_set_calls == 64);
  require (pvst_param_set (synth, fake_vst3::kGainId, .999f) == PVST_ERROR_QUEUE_FULL);
  require (fake_vst3::failures.controller_set_calls == 64);
  require (pvst_param_get (synth, fake_vst3::kGainId) == last_gain);
  require (pvst_process (synth, nullptr, output.data (), 1) == PVST_OK);
  require (fake_vst3::failures.parameter_queue_count == 2);
  require (fake_vst3::failures.parameter_point_count == 64);
  require (fake_vst3::failures.parameter_queues[0].point_count == 32);
  require (fake_vst3::failures.parameter_queues[1].point_count == 32);
  require (pvst_param_set (synth, fake_vst3::kGainId, .5f) == PVST_OK);
  pvst_destroy (synth);
}

void process_is_allocation_free_after_warmup_with_queued_data () {
  fake_vst3::failures.reset ();
  std::array<float, 256> output {};
  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  require (pvst_note_on (synth, 48, .25f) == PVST_OK);
  require (pvst_param_set (synth, fake_vst3::kGainId, .3f) == PVST_OK);
  require (pvst_process (synth, nullptr, output.data (), 128) == PVST_OK);
  fake_vst3::failures.clear_process_observations ();

  require (pvst_note_off (synth, 48) == PVST_OK);
  require (pvst_param_set (synth, fake_vst3::kGainId, .4f) == PVST_OK);
  require (pvst_param_set (synth, fake_vst3::kMixId, .7f) == PVST_OK);
  allocation_probe::count = 0;
  allocation_probe::enabled = true;
  const auto result = pvst_process (synth, nullptr, output.data (), 128);
  allocation_probe::enabled = false;
  require (result == PVST_OK);
  require (allocation_probe::count == 0);
  require (fake_vst3::failures.event_count == 1);
  require (fake_vst3::failures.parameter_point_count == 2);
  pvst_destroy (synth);
}
} // namespace

int process_test () {
  std::array<float, 256> output {};
  fake_vst3::failures.reset ();
  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  require (pvst_note_on (synth, 60, .5f) == PVST_OK);
  require (pvst_process (synth, nullptr, output.data (), 128) == PVST_OK);
  bool nonzero = false;
  for (auto value : output) nonzero |= value != 0.f;
  require (nonzero);
  require (pvst_process (synth, nullptr, output.data (), 129) == PVST_ERROR_FRAME_COUNT);
  for (int event = 0; event < 64; ++event) require (pvst_note_on (synth, 60, .5f) == PVST_OK);
  require (pvst_note_on (synth, 60, .5f) == PVST_ERROR_QUEUE_FULL);
  require (pvst_process (synth, nullptr, output.data (), 128) == PVST_OK);
  pvst_destroy (synth);

  std::array<float, 256> input {};
  std::array<float, 256> effected {};
  for (uint32_t frame = 0; frame < 128; ++frame) { input[2 * frame] = .25f; input[2 * frame + 1] = .5f; }
  fake_vst3::failures.reset ();
  const auto effect = pvst_create (1, 48000., 128);
  require (effect != 0);
  require (pvst_process (effect, input.data (), effected.data (), 128) == PVST_OK);
  require (effected[0] == .25f * .25f);
  require (effected[1] == .5f * .25f);
  pvst_destroy (effect);

  note_events_use_the_matching_union_and_support_callback_qi ();
  parameter_points_are_grouped_by_id ();
  the_sixty_fifth_parameter_point_is_atomic ();
  process_is_allocation_free_after_warmup_with_queued_data ();
  return 0;
}
