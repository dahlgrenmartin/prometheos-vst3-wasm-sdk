#include "fake_factory.h"
#include <array>
#include <cassert>
int process_test () {
  std::array<float, 128> output {};
  const auto synth = pvst_create (0, 48000.0, 128); assert (synth != 0);
  assert (pvst_note_on (synth, 60, .5f) == PVST_OK);
  assert (pvst_process (synth, nullptr, output.data (), 128) == PVST_OK);
  bool nonzero = false; for (auto value : output) nonzero |= value != 0.f; assert (nonzero);
  assert (pvst_process (synth, nullptr, output.data (), 129) == PVST_ERROR_FRAME_COUNT);
  pvst_destroy (synth); return 0;
}
