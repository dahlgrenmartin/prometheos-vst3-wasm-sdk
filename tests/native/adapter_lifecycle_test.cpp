#include "fake_factory.h"
#include <cassert>
#include <cstdlib>
#include <cmath>
#undef assert
#define assert(condition) do { if (!(condition)) std::abort (); } while (false)
int lifecycle_test () {
  assert (pvst_class_count () == 2);
  assert (pvst_class_name_size (0) == 11);
  assert (pvst_class_param_count (0) == 1);
  assert (pvst_class_param_id (0, 0) == fake_vst3::kGainId);
  assert (pvst_class_param_value_text_size (0, 0, .75f) == 5);
  assert (fake_vst3::factory.refs () == 1);
  const auto synth = pvst_create (0, 48000.0, 128); assert (synth != 0);
  assert (pvst_create (2, 48000.0, 128) == 0);
  assert (pvst_create (0, NAN, 128) == 0);
  pvst_destroy (synth); assert (pvst_reset (synth) == PVST_ERROR_HANDLE); assert (fake_vst3::factory.refs () == 1);
  fake_vst3::failures.reset (); fake_vst3::failures.fail_second_connect = true; assert (pvst_create (0,48000.,128) == 0); assert (fake_vst3::failures.connects == 2 && fake_vst3::failures.disconnects == 1); return 0;
}
