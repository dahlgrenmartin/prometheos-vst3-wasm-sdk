#include "fake_factory.h"
#include <array>
#include <cassert>
#include <cstdlib>
#undef assert
#define assert(condition) do { if (!(condition)) std::abort (); } while (false)
int process_test () {
  std::array<float, 256> output {};
  const auto synth = pvst_create (0, 48000.0, 128); assert (synth != 0);
  assert (pvst_note_on (synth, 60, .5f) == PVST_OK);
  assert (pvst_process (synth, nullptr, output.data (), 128) == PVST_OK);
  bool nonzero = false; for (auto value : output) nonzero |= value != 0.f; assert (nonzero);
  assert (pvst_process (synth, nullptr, output.data (), 129) == PVST_ERROR_FRAME_COUNT);
  for (int i=0;i<64;++i) assert(pvst_note_on(synth,60,.5f)==PVST_OK); assert(pvst_note_on(synth,60,.5f)==PVST_ERROR_QUEUE_FULL); assert(pvst_process(synth,nullptr,output.data(),128)==PVST_OK);
  std::array<float, 256> input {}; std::array<float, 256> effected {}; for (uint32_t i=0;i<128;++i) { input[2*i]=.25f; input[2*i+1]=.5f; }
  const auto effect = pvst_create (1, 48000., 128); assert (effect != 0); assert (pvst_process(effect,input.data(),effected.data(),128)==PVST_OK); assert(effected[0] == .25f*.25f && effected[1] == .5f*.25f); pvst_destroy(effect);
  pvst_destroy (synth); return 0;
}
