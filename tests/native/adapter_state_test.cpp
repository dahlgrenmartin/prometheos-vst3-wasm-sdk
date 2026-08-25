#define PVST_DEFINE_FAKE_FACTORY
#include "fake_factory.h"
#include <array>
#include <cassert>
#include <cstdlib>
#undef assert
#define assert(condition) do { if (!(condition)) std::abort (); } while (false)
int process_test ();
int lifecycle_test ();
int main () {
  lifecycle_test ();
  process_test ();
  const auto first = pvst_create (0, 48000.0, 128); assert (first != 0);
  assert (pvst_param_set (first, fake_vst3::kGainId, .75f) == PVST_OK);
  const auto size = pvst_state_size (first); assert (size > 16);
  std::array<unsigned char, 256> bytes {}; assert (pvst_state_write (first, bytes.data (), size) == PVST_OK);
  const auto second = pvst_create (0, 48000.0, 128); assert (second != 0);
  assert (pvst_state_load (second, bytes.data (), size) == PVST_OK);
  assert (pvst_param_get (second, fake_vst3::kGainId) == .75f);
  assert (pvst_state_load (second, bytes.data (), 3) == PVST_ERROR_ARGUMENT);
  pvst_destroy (first); pvst_destroy (second);
}
