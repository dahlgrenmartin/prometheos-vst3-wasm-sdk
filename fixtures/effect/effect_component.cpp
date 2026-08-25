#include "effect_component.h"
#include "fixtures/common/fixture_ids.h"

#include <cstring>
#include <pluginterfaces/base/ibstream.h>
#include <pluginterfaces/vst/ivstparameterchanges.h>

namespace prometheos::fixtures {
using namespace Steinberg;
using namespace Steinberg::Vst;
namespace {
bool same (const TUID lhs, const TUID rhs) { return FUnknownPrivate::iidEqual (lhs, rhs); }
tresult write_value (IBStream* stream, double value) { int32 written {}; return stream && stream->write (&value, sizeof value, &written) == kResultOk && written == sizeof value ? kResultOk : kResultFalse; }
tresult read_value (IBStream* stream, double& value) { int32 read {}; return stream && stream->read (&value, sizeof value, &read) == kResultOk && read == sizeof value ? kResultOk : kResultFalse; }
void apply_gain_changes (IParameterChanges* changes, double& gain) { if (!changes) return; for (int32 queue_index = 0; queue_index < changes->getParameterCount (); ++queue_index) { auto* queue = changes->getParameterData (queue_index); if (!queue || queue->getParameterId () != kEffectGainId || queue->getPointCount () == 0) continue; int32 sample_offset {}; ParamValue value {}; if (queue->getPoint (queue->getPointCount () - 1, sample_offset, value) == kResultOk) gain = value; } }
} // namespace
FUnknown* EffectComponent::create_instance (void*) { return static_cast<IComponent*> (new EffectComponent); }
tresult PLUGIN_API EffectComponent::queryInterface (const TUID iid, void** out) { if (!out) return kInvalidArgument; *out = nullptr; if (same (iid, INLINE_UID_OF(FUnknown)) || same (iid, INLINE_UID_OF(IComponent))) *out = static_cast<IComponent*> (this); else if (same (iid, INLINE_UID_OF(IAudioProcessor))) *out = static_cast<IAudioProcessor*> (this); if (!*out) return kNoInterface; addRef (); return kResultOk; }
uint32 PLUGIN_API EffectComponent::addRef () { return ++refs_; } uint32 PLUGIN_API EffectComponent::release () { const auto refs = --refs_; if (!refs) delete this; return refs; }
tresult PLUGIN_API EffectComponent::initialize (FUnknown*) { return kResultOk; } tresult PLUGIN_API EffectComponent::terminate () { return kResultOk; }
tresult PLUGIN_API EffectComponent::getControllerClassId (TUID id) { std::memcpy (id, kEffectControllerCid, sizeof TUID); return kResultOk; } tresult PLUGIN_API EffectComponent::setIoMode (IoMode) { return kResultOk; }
int32 PLUGIN_API EffectComponent::getBusCount (MediaType type, BusDirection) { return type == kAudio ? 1 : 0; }
tresult PLUGIN_API EffectComponent::getBusInfo (MediaType type, BusDirection direction, int32 index, BusInfo& info) { if (type != kAudio || index) return kInvalidArgument; info = {}; info.mediaType = type; info.direction = direction; info.channelCount = 2; info.busType = kMain; info.flags = BusInfo::kDefaultActive; return kResultOk; }
tresult PLUGIN_API EffectComponent::getRoutingInfo (RoutingInfo&, RoutingInfo&) { return kResultFalse; } tresult PLUGIN_API EffectComponent::activateBus (MediaType, BusDirection, int32, TBool) { return kResultOk; } tresult PLUGIN_API EffectComponent::setActive (TBool) { return kResultOk; }
tresult PLUGIN_API EffectComponent::setState (IBStream* stream) { return read_value (stream, gain_); } tresult PLUGIN_API EffectComponent::getState (IBStream* stream) { return write_value (stream, gain_); }
tresult PLUGIN_API EffectComponent::setBusArrangements (SpeakerArrangement* inputs, int32 input_count, SpeakerArrangement* outputs, int32 output_count) {
  return inputs && outputs && input_count == 1 && output_count == 1 && inputs[0] == SpeakerArr::kStereo && outputs[0] == SpeakerArr::kStereo ? kResultOk : kResultFalse;
}
tresult PLUGIN_API EffectComponent::getBusArrangement (BusDirection, int32 index, SpeakerArrangement& arrangement) { if (index) return kResultFalse; arrangement = SpeakerArr::kStereo; return kResultOk; }
tresult PLUGIN_API EffectComponent::canProcessSampleSize (int32 size) { return size == kSample32 ? kResultOk : kResultFalse; } uint32 PLUGIN_API EffectComponent::getLatencySamples () { return 0; } tresult PLUGIN_API EffectComponent::setupProcessing (ProcessSetup&) { return kResultOk; } tresult PLUGIN_API EffectComponent::setProcessing (TBool) { return kResultOk; }
tresult PLUGIN_API EffectComponent::process (ProcessData& data) {
  if (data.symbolicSampleSize != kSample32 || data.numSamples < 0 || data.numInputs != 1 || data.numOutputs != 1 || !data.inputs || !data.outputs ||
      data.inputs[0].numChannels != 2 || data.outputs[0].numChannels != 2 || !data.inputs[0].channelBuffers32 || !data.outputs[0].channelBuffers32 ||
      !data.inputs[0].channelBuffers32[0] || !data.inputs[0].channelBuffers32[1] || !data.outputs[0].channelBuffers32[0] || !data.outputs[0].channelBuffers32[1]) return kInvalidArgument;
  apply_gain_changes (data.inputParameterChanges, gain_);
  for (int channel = 0; channel < 2; ++channel) for (int32 frame = 0; frame < data.numSamples; ++frame)
    data.outputs[0].channelBuffers32[channel][frame] = data.inputs[0].channelBuffers32[channel][frame] * static_cast<float> (gain_);
  return kResultOk;
}
uint32 PLUGIN_API EffectComponent::getTailSamples () { return kNoTail; }
} // namespace prometheos::fixtures
