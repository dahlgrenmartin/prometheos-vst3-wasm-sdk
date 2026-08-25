#include "instrument_component.h"
#include "fixtures/common/fixture_ids.h"

#include <cmath>
#include <cstring>
#include <pluginterfaces/base/ibstream.h>
#include <pluginterfaces/vst/ivstevents.h>
#include <pluginterfaces/vst/ivstparameterchanges.h>

namespace prometheos::fixtures {
using namespace Steinberg;
using namespace Steinberg::Vst;
namespace {
bool same (const TUID lhs, const TUID rhs) { return FUnknownPrivate::iidEqual (lhs, rhs); }
tresult write_value (IBStream* stream, double value) { int32 written {}; return stream && stream->write (&value, sizeof value, &written) == kResultOk && written == sizeof value ? kResultOk : kResultFalse; }
tresult read_value (IBStream* stream, double& value) { int32 read {}; return stream && stream->read (&value, sizeof value, &read) == kResultOk && read == sizeof value ? kResultOk : kResultFalse; }
void apply_gain_changes (IParameterChanges* changes, double& gain) {
  if (!changes) return;
  for (int32 queue_index = 0; queue_index < changes->getParameterCount (); ++queue_index) {
    auto* queue = changes->getParameterData (queue_index);
    if (!queue || queue->getParameterId () != kInstrumentGainId || queue->getPointCount () == 0) continue;
    int32 sample_offset {}; ParamValue value {};
    if (queue->getPoint (queue->getPointCount () - 1, sample_offset, value) == kResultOk) gain = value;
  }
}
} // namespace

FUnknown* InstrumentComponent::create_instance (void*) { return static_cast<IComponent*> (new InstrumentComponent); }
tresult PLUGIN_API InstrumentComponent::queryInterface (const TUID iid, void** out) {
  if (!out) return kInvalidArgument;
  *out = nullptr;
  if (same (iid, INLINE_UID_OF(FUnknown)) || same (iid, INLINE_UID_OF(IComponent))) *out = static_cast<IComponent*> (this);
  else if (same (iid, INLINE_UID_OF(IAudioProcessor))) *out = static_cast<IAudioProcessor*> (this);
  if (!*out) return kNoInterface;
  addRef (); return kResultOk;
}
uint32 PLUGIN_API InstrumentComponent::addRef () { return ++refs_; }
uint32 PLUGIN_API InstrumentComponent::release () { const auto refs = --refs_; if (!refs) delete this; return refs; }
tresult PLUGIN_API InstrumentComponent::initialize (FUnknown*) { return kResultOk; }
tresult PLUGIN_API InstrumentComponent::terminate () { return kResultOk; }
tresult PLUGIN_API InstrumentComponent::getControllerClassId (TUID id) { std::memcpy (id, kInstrumentControllerCid, sizeof TUID); return kResultOk; }
tresult PLUGIN_API InstrumentComponent::setIoMode (IoMode) { return kResultOk; }
int32 PLUGIN_API InstrumentComponent::getBusCount (MediaType type, BusDirection direction) { return type == kAudio ? direction == kOutput ? 1 : 0 : type == kEvent && direction == kInput ? 1 : 0; }
tresult PLUGIN_API InstrumentComponent::getBusInfo (MediaType type, BusDirection direction, int32 index, BusInfo& info) {
  if (index || getBusCount (type, direction) != 1) return kInvalidArgument;
  info = {}; info.mediaType = type; info.direction = direction; info.channelCount = type == kAudio ? 2 : 16; info.busType = kMain; info.flags = BusInfo::kDefaultActive; return kResultOk;
}
tresult PLUGIN_API InstrumentComponent::getRoutingInfo (RoutingInfo&, RoutingInfo&) { return kResultFalse; }
tresult PLUGIN_API InstrumentComponent::activateBus (MediaType, BusDirection, int32, TBool) { return kResultOk; }
tresult PLUGIN_API InstrumentComponent::setActive (TBool) { return kResultOk; }
tresult PLUGIN_API InstrumentComponent::setState (IBStream* stream) { return read_value (stream, gain_); }
tresult PLUGIN_API InstrumentComponent::getState (IBStream* stream) { return write_value (stream, gain_); }
tresult PLUGIN_API InstrumentComponent::setBusArrangements (SpeakerArrangement* inputs, int32 input_count, SpeakerArrangement* outputs, int32 output_count) {
  return input_count == 0 && outputs && output_count == 1 && outputs[0] == SpeakerArr::kStereo ? kResultOk : kResultFalse;
}
tresult PLUGIN_API InstrumentComponent::getBusArrangement (BusDirection direction, int32 index, SpeakerArrangement& arrangement) { if (direction != kOutput || index) return kResultFalse; arrangement = SpeakerArr::kStereo; return kResultOk; }
tresult PLUGIN_API InstrumentComponent::canProcessSampleSize (int32 size) { return size == kSample32 ? kResultOk : kResultFalse; }
uint32 PLUGIN_API InstrumentComponent::getLatencySamples () { return 0; }
tresult PLUGIN_API InstrumentComponent::setupProcessing (ProcessSetup& setup) { sample_rate_ = setup.sampleRate; return sample_rate_ > 0. ? kResultOk : kResultFalse; }
tresult PLUGIN_API InstrumentComponent::setProcessing (TBool) { return kResultOk; }
tresult PLUGIN_API InstrumentComponent::process (ProcessData& data) {
  if (data.symbolicSampleSize != kSample32 || data.numSamples < 0 || data.numOutputs != 1 || !data.outputs ||
      data.outputs[0].numChannels != 2 || !data.outputs[0].channelBuffers32 ||
      !data.outputs[0].channelBuffers32[0] || !data.outputs[0].channelBuffers32[1]) return kInvalidArgument;
  apply_gain_changes (data.inputParameterChanges, gain_);
  for (int32 frame = 0; frame < data.numSamples; ++frame) {
    if (data.inputEvents) for (int32 index = 0; index < data.inputEvents->getEventCount (); ++index) {
      Event event {}; if (data.inputEvents->getEvent (index, event) != kResultOk || event.sampleOffset != frame) continue;
      if (event.type == Event::kNoteOnEvent) { note_ = event.noteOn.pitch; note_id_ = event.noteOn.noteId; velocity_ = event.noteOn.velocity; playing_ = true; }
      else if (event.type == Event::kNoteOffEvent && playing_ && event.noteOff.pitch == note_ && event.noteOff.noteId == note_id_) playing_ = false;
    }
    const auto increment = 6.28318530717958647692 * 440. * std::pow (2., (note_ - 69) / 12.) / sample_rate_;
    const auto sample = playing_ ? static_cast<float> (std::sin (phase_) * gain_ * velocity_) : 0.f;
    data.outputs[0].channelBuffers32[0][frame] = sample;
    data.outputs[0].channelBuffers32[1][frame] = sample;
    if (playing_) { phase_ += increment; if (phase_ >= 6.28318530717958647692) phase_ -= 6.28318530717958647692; }
  }
  return kResultOk;
}
uint32 PLUGIN_API InstrumentComponent::getTailSamples () { return kNoTail; }
} // namespace prometheos::fixtures
