#include "fixtures/effect/effect_component.h"
#include "fixtures/instrument/instrument_component.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <pluginterfaces/vst/ivstevents.h>

namespace {
using namespace Steinberg;
using namespace Steinberg::Vst;

void require_at (bool condition, int line) {
  if (!condition) {
    std::fprintf (stderr, "actual VST3 component requirement failed at line %d\n", line);
    std::abort ();
  }
}
#define require(condition) require_at ((condition), __LINE__)

class Events final : public IEventList {
public:
  tresult PLUGIN_API queryInterface (const TUID iid, void** out) override {
    if (!out) return kInvalidArgument;
    *out = nullptr;
    if (FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(FUnknown)) ||
        FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(IEventList))) *out = static_cast<IEventList*> (this);
    if (!*out) return kNoInterface;
    addRef (); return kResultOk;
  }
  uint32 PLUGIN_API addRef () override { return ++refs_; }
  uint32 PLUGIN_API release () override { return --refs_; }
  int32 PLUGIN_API getEventCount () override { return count_; }
  tresult PLUGIN_API getEvent (int32 index, Event& event) override {
    if (index < 0 || index >= count_) return kInvalidArgument;
    event = events_[index]; return kResultOk;
  }
  tresult PLUGIN_API addEvent (Event& event) override {
    if (count_ == static_cast<int32> (events_.size ())) return kResultFalse;
    events_[count_++] = event; return kResultOk;
  }
private:
  uint32 refs_ {1};
  std::array<Event, 4> events_ {};
  int32 count_ {};
};

IComponent* make_component (FUnknown* (*create) (void*)) {
  auto* unknown = create (nullptr);
  IComponent* component {};
  require (unknown->queryInterface (INLINE_UID_OF(IComponent), reinterpret_cast<void**> (&component)) == kResultOk);
  unknown->release ();
  require (component->initialize (nullptr) == kResultOk);
  return component;
}

IAudioProcessor* processor_for (IComponent* component) {
  IAudioProcessor* processor {};
  require (component->queryInterface (INLINE_UID_OF(IAudioProcessor), reinterpret_cast<void**> (&processor)) == kResultOk);
  ProcessSetup setup {};
  setup.processMode = kRealtime;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = 128;
  setup.sampleRate = 48000.;
  require (processor->setupProcessing (setup) == kResultOk);
  return processor;
}

Event note_on (int32 offset, int16 pitch, int32 note_id) {
  Event event {};
  event.busIndex = 0; event.sampleOffset = offset; event.type = Event::kNoteOnEvent;
  event.noteOn.channel = 0; event.noteOn.pitch = pitch; event.noteOn.velocity = 1.f; event.noteOn.noteId = note_id;
  return event;
}

Event note_off (int32 offset, int16 pitch, int32 note_id) {
  Event event {};
  event.busIndex = 0; event.sampleOffset = offset; event.type = Event::kNoteOffEvent;
  event.noteOff.channel = 0; event.noteOff.pitch = pitch; event.noteOff.noteId = note_id;
  return event;
}

bool has_signal (const float* samples, int32 begin, int32 end) {
  for (int32 frame = begin; frame < end; ++frame)
    if (std::fabs (samples[frame]) > .0001f) return true;
  return false;
}

void components_require_exact_stereo_arrangements_and_valid_audio_buffers () {
  auto* instrument = make_component (webvst::fixtures::InstrumentComponent::create_instance);
  auto* instrument_processor = processor_for (instrument);
  SpeakerArrangement stereo = SpeakerArr::kStereo;
  SpeakerArrangement mono = SpeakerArr::kMono;
  require (instrument_processor->setBusArrangements (nullptr, 0, &stereo, 1) == kResultOk);
  require (instrument_processor->setBusArrangements (nullptr, 0, &mono, 1) != kResultOk);

  std::array<float, 8> left {};
  std::array<float, 8> right {};
  std::array<Sample32*, 2> output_channels {left.data (), right.data ()};
  AudioBusBuffers output {};
  output.numChannels = 1;
  output.channelBuffers32 = output_channels.data ();
  ProcessData data {};
  data.symbolicSampleSize = kSample32; data.numSamples = 8; data.numOutputs = 1; data.outputs = &output;
  require (instrument_processor->process (data) == kInvalidArgument);
  output.numChannels = 2;
  output_channels[1] = nullptr;
  require (instrument_processor->process (data) == kInvalidArgument);
  instrument_processor->release (); instrument->terminate (); instrument->release ();

  auto* effect = make_component (webvst::fixtures::EffectComponent::create_instance);
  auto* effect_processor = processor_for (effect);
  require (effect_processor->setBusArrangements (&stereo, 1, &stereo, 1) == kResultOk);
  require (effect_processor->setBusArrangements (&mono, 1, &mono, 1) != kResultOk);
  std::array<Sample32*, 2> input_channels {left.data (), right.data ()};
  output_channels[1] = right.data ();
  AudioBusBuffers input {};
  input.numChannels = 1; input.channelBuffers32 = input_channels.data ();
  output.numChannels = 2; output.channelBuffers32 = output_channels.data ();
  data = {};
  data.symbolicSampleSize = kSample32; data.numSamples = 8; data.numInputs = 1; data.inputs = &input; data.numOutputs = 1; data.outputs = &output;
  require (effect_processor->process (data) == kInvalidArgument);
  input.numChannels = 2;
  input_channels[1] = nullptr;
  require (effect_processor->process (data) == kInvalidArgument);
  effect_processor->release (); effect->terminate (); effect->release ();
}

void instrument_applies_note_events_at_their_sample_offsets_and_matches_note_off_identity () {
  auto* instrument = make_component (webvst::fixtures::InstrumentComponent::create_instance);
  auto* processor = processor_for (instrument);
  std::array<float, 128> left {};
  std::array<float, 128> right {};
  std::array<Sample32*, 2> channels {left.data (), right.data ()};
  AudioBusBuffers output {};
  output.numChannels = 2; output.channelBuffers32 = channels.data ();

  Events first_events {};
  auto on = note_on (64, 69, 7);
  auto unrelated_off = note_off (96, 69, 8);
  require (first_events.addEvent (on) == kResultOk);
  require (first_events.addEvent (unrelated_off) == kResultOk);
  ProcessData data {};
  data.symbolicSampleSize = kSample32; data.numSamples = 128; data.numOutputs = 1; data.outputs = &output; data.inputEvents = &first_events;
  require (processor->process (data) == kResultOk);
  require (!has_signal (left.data (), 0, 64));
  require (has_signal (left.data (), 64, 128));

  left.fill (0.f); right.fill (0.f);
  Events second_events {};
  auto off = note_off (32, 69, 7);
  require (second_events.addEvent (off) == kResultOk);
  data.inputEvents = &second_events;
  require (processor->process (data) == kResultOk);
  require (has_signal (left.data (), 0, 32));
  require (!has_signal (left.data (), 32, 128));
  processor->release (); instrument->terminate (); instrument->release ();
}
} // namespace

int main () {
  components_require_exact_stereo_arrangements_and_valid_audio_buffers ();
  instrument_applies_note_events_at_their_sample_offsets_and_matches_note_off_identity ();
  return 0;
}
