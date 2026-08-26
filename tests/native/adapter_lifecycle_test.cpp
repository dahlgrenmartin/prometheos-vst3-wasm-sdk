#include "fake_factory.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {
void require_at (bool condition, int line) { if (!condition) { std::fprintf (stderr, "lifecycle requirement failed at line %d\n", line); std::abort (); } }
#define require(condition) require_at ((condition), __LINE__)

template <size_t Size>
void require_calls (const std::array<fake_vst3::Call, Size>& expected) {
  require (fake_vst3::failures.call_count == expected.size ());
  for (size_t index = 0; index < expected.size (); ++index)
    require (fake_vst3::failures.calls[index] == expected[index]);
}

void successful_separate_lifecycle_is_strictly_ordered () {
  using fake_vst3::Call;
  fake_vst3::failures.reset ();
  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  pvst_destroy (synth);
  require_calls (std::array {
    Call::FactoryCreateComponent,
    Call::ComponentInitialize,
    Call::ProcessorQuery,
    Call::ControllerClassId,
    Call::FactoryCreateController,
    Call::ControllerInitialize,
    Call::ComponentConnectionQuery,
    Call::ControllerConnectionQuery,
    Call::ComponentConnect,
    Call::ControllerConnect,
    Call::InputBusCount,
    Call::OutputBusCount,
    Call::OutputBusInfo,
    Call::BusArrangements,
    Call::SampleSize,
    Call::SetupProcessing,
    Call::OutputBusActivate,
    Call::ComponentActive,
    Call::ProcessingStart,
    Call::ProcessingStop,
    Call::ComponentInactive,
    Call::OutputBusDeactivate,
    Call::ControllerDisconnect,
    Call::ComponentDisconnect,
    Call::ControllerTerminate,
    Call::ComponentTerminate,
  });
  require (fake_vst3::failures.live_objects == 0);
  require (fake_vst3::failures.component_initialize_successes == 1);
  require (fake_vst3::failures.controller_initialize_successes == 1);
  require (fake_vst3::failures.component_terminates == 1);
  require (fake_vst3::failures.controller_terminates == 1);
}

void every_failed_stage_unwinds_only_successful_initializations () {
  using fake_vst3::FailurePoint;
  struct Case { FailurePoint point; uint32_t class_index; };
  constexpr std::array cases {
    Case {FailurePoint::FactoryCreateComponent, 0},
    Case {FailurePoint::ComponentInitialize, 0},
    Case {FailurePoint::ProcessorQuery, 0},
    Case {FailurePoint::FactoryCreateController, 0},
    Case {FailurePoint::ControllerInitialize, 0},
    Case {FailurePoint::ComponentConnect, 0},
    Case {FailurePoint::ControllerConnect, 0},
    Case {FailurePoint::InputBusCount, 1},
    Case {FailurePoint::InputBusInfo, 1},
    Case {FailurePoint::OutputBusCount, 0},
    Case {FailurePoint::OutputBusInfo, 0},
    Case {FailurePoint::BusArrangements, 0},
    Case {FailurePoint::SampleSize, 0},
    Case {FailurePoint::SetupProcessing, 0},
    Case {FailurePoint::InputBusActivate, 1},
    Case {FailurePoint::OutputBusActivate, 1},
    Case {FailurePoint::ComponentActive, 1},
    Case {FailurePoint::ProcessingStart, 1},
  };
  for (const auto& test : cases) {
    fake_vst3::failures.reset ();
    fake_vst3::failures.fail_at = test.point;
    require (pvst_create (test.class_index, 48000., 128) == 0);
    require (fake_vst3::failures.live_objects == 0);
    require (fake_vst3::failures.component_terminates == fake_vst3::failures.component_initialize_successes);
    require (fake_vst3::failures.controller_terminates == fake_vst3::failures.controller_initialize_successes);
    require (fake_vst3::factory.refs () == 1);
    if (test.point == FailurePoint::OutputBusActivate || test.point == FailurePoint::ComponentActive || test.point == FailurePoint::ProcessingStart)
      require (fake_vst3::failures.count (fake_vst3::Call::InputBusDeactivate) == 1);
  }
}

void connection_points_are_optional_but_partial_connections_are_unwound () {
  using fake_vst3::Call;
  fake_vst3::failures.reset ();
  fake_vst3::failures.omit_component_connection = true;
  const auto without_component_connection = pvst_create (0, 48000., 128);
  require (without_component_connection != 0);
  require (fake_vst3::failures.count (Call::ComponentConnect) == 0);
  require (fake_vst3::failures.count (Call::ControllerConnect) == 0);
  pvst_destroy (without_component_connection);
  require (fake_vst3::failures.live_objects == 0);

  fake_vst3::failures.reset ();
  fake_vst3::failures.omit_controller_connection = true;
  const auto without_controller_connection = pvst_create (0, 48000., 128);
  require (without_controller_connection != 0);
  require (fake_vst3::failures.count (Call::ComponentConnect) == 0);
  require (fake_vst3::failures.count (Call::ControllerConnect) == 0);
  pvst_destroy (without_controller_connection);
  require (fake_vst3::failures.live_objects == 0);

  fake_vst3::failures.reset ();
  fake_vst3::failures.fail_at = fake_vst3::FailurePoint::ControllerConnect;
  require (pvst_create (0, 48000., 128) == 0);
  require (fake_vst3::failures.count (Call::ComponentConnect) == 1);
  require (fake_vst3::failures.count (Call::ControllerConnect) == 1);
  require (fake_vst3::failures.count (Call::ComponentDisconnect) == 1);
  require (fake_vst3::failures.count (Call::ControllerDisconnect) == 0);
  require (fake_vst3::failures.live_objects == 0);
}

void combined_component_controller_is_not_initialized_connected_or_terminated_twice () {
  using fake_vst3::Call;
  fake_vst3::failures.reset ();
  fake_vst3::failures.combined_controller = true;
  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  require (fake_vst3::failures.live_objects == 1);
  require (fake_vst3::failures.component_initialize_successes == 1);
  require (fake_vst3::failures.controller_initialize_successes == 0);
  require (fake_vst3::failures.count (Call::ComponentConnectionQuery) == 0);
  require (fake_vst3::failures.count (Call::ControllerConnectionQuery) == 0);
  require (fake_vst3::failures.count (Call::ComponentConnect) == 0);
  pvst_destroy (synth);
  require (fake_vst3::failures.component_terminates == 1);
  require (fake_vst3::failures.controller_terminates == 0);
  require (fake_vst3::failures.live_objects == 0);
}

void reset_tracks_the_real_processing_stage_after_each_failure () {
  using fake_vst3::Call;
  using fake_vst3::FailurePoint;

  fake_vst3::failures.reset ();
  auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  fake_vst3::failures.fail_at = FailurePoint::ProcessingStop;
  require (pvst_reset (synth) == PVST_ERROR_PLUGIN);
  fake_vst3::failures.fail_at = FailurePoint::None;
  pvst_destroy (synth);
  require (fake_vst3::failures.count (Call::ProcessingStop) == 2);

  fake_vst3::failures.reset ();
  synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  fake_vst3::failures.fail_at = FailurePoint::ProcessingStart;
  require (pvst_reset (synth) == PVST_ERROR_PLUGIN);
  require (fake_vst3::failures.count (Call::ProcessingStop) == 1);
  fake_vst3::failures.fail_at = FailurePoint::None;
  require (pvst_reset (synth) == PVST_OK);
  pvst_destroy (synth);
  require (fake_vst3::failures.count (Call::ProcessingStop) == 2);
  require (fake_vst3::failures.live_objects == 0);
}

void parameter_text_is_checked_utf8 () {
  fake_vst3::failures.reset ();
  constexpr std::array<char, 10> expected_title {'G', static_cast<char> (0xc3), static_cast<char> (0xa4), 'i', 'n', ' ', static_cast<char> (0xf0), static_cast<char> (0x9f), static_cast<char> (0x8e), static_cast<char> (0x9a)};
  constexpr std::array<char, 4> expected_value {static_cast<char> (0xc2), static_cast<char> (0xbe), static_cast<char> (0xc3), static_cast<char> (0x97)};
  std::array<char, 16> text {};
  require (pvst_class_param_title_size (0, 0) == expected_title.size ());
  require (pvst_class_param_title_write (0, 0, text.data (), static_cast<uint32_t> (expected_title.size () - 1)) == PVST_ERROR_BUFFER_TOO_SMALL);
  require (pvst_class_param_title_write (0, 0, text.data (), static_cast<uint32_t> (text.size ())) == PVST_OK);
  require (std::memcmp (text.data (), expected_title.data (), expected_title.size ()) == 0);
  text = {};
  require (pvst_class_param_value_text_size (0, 0, .75f) == expected_value.size ());
  require (pvst_class_param_value_text_write (0, 0, .75f, text.data (), static_cast<uint32_t> (text.size ())) == PVST_OK);
  require (std::memcmp (text.data (), expected_value.data (), expected_value.size ()) == 0);

  fake_vst3::failures.invalid_utf16 = true;
  require (pvst_class_param_title_size (0, 0) == 0);
  require (pvst_class_param_title_write (0, 0, text.data (), static_cast<uint32_t> (text.size ())) == PVST_ERROR_PLUGIN);
  require (pvst_class_param_value_text_size (0, 0, .75f) == 0);
  require (pvst_class_param_value_text_write (0, 0, .75f, text.data (), static_cast<uint32_t> (text.size ())) == PVST_ERROR_PLUGIN);
  fake_vst3::failures.reset ();
}
} // namespace

int lifecycle_test () {
  require (pvst_class_count () == 2);
  require (pvst_class_name_size (0) == 10);
  require (pvst_class_param_count (0) == 2);
  require (pvst_class_param_id (0, 0) == fake_vst3::kGainId);
  require (fake_vst3::factory.refs () == 1);
  parameter_text_is_checked_utf8 ();

  successful_separate_lifecycle_is_strictly_ordered ();
  every_failed_stage_unwinds_only_successful_initializations ();
  connection_points_are_optional_but_partial_connections_are_unwound ();
  combined_component_controller_is_not_initialized_connected_or_terminated_twice ();
  reset_tracks_the_real_processing_stage_after_each_failure ();

  const auto synth = pvst_create (0, 48000., 128);
  require (synth != 0);
  require (pvst_create (2, 48000., 128) == 0);
  require (pvst_create (0, NAN, 128) == 0);
  pvst_destroy (synth);
  require (pvst_reset (synth) == PVST_ERROR_HANDLE);
  require (fake_vst3::factory.refs () == 1);
  return 0;
}
