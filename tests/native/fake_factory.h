#pragma once

#include <algorithm>
#include <array>
#include <cstring>
#include <string>
#include <prometheos/webvst.h>
#include <pluginterfaces/base/ibstream.h>
#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivsteditcontroller.h>
#include <pluginterfaces/vst/ivstevents.h>
#include <pluginterfaces/vst/ivsthostapplication.h>
#include <pluginterfaces/vst/ivstmessage.h>

namespace fake_vst3 {
using namespace Steinberg;
using namespace Steinberg::Vst;

inline bool same (const TUID a, const TUID b) { return std::memcmp (a, b, 16) == 0; }
inline constexpr TUID kSynthCid = INLINE_UID (0x10203040, 0x50607080, 0x90A0B0C0, 0xD0E0F001);
inline constexpr TUID kEffectCid = INLINE_UID (0x10203041, 0x50607080, 0x90A0B0C0, 0xD0E0F002);
constexpr ParamID kGainId = 71;

class Plugin final : public IComponent, public IAudioProcessor, public IEditController, public IConnectionPoint {
public:
  explicit Plugin (bool synth) : synth_ (synth) {}
  tresult PLUGIN_API queryInterface (const TUID iid, void** out) override {
    if (!out) return kInvalidArgument; *out = nullptr;
    if (same (iid, INLINE_UID_OF(IComponent))) *out = static_cast<IComponent*> (this);
    else if (same (iid, INLINE_UID_OF(IAudioProcessor))) *out = static_cast<IAudioProcessor*> (this);
    else if (same (iid, INLINE_UID_OF(IEditController))) *out = static_cast<IEditController*> (this);
    else if (same (iid, INLINE_UID_OF(IConnectionPoint))) *out = static_cast<IConnectionPoint*> (this);
    else return kNoInterface;
    addRef (); return kResultOk;
  }
  uint32 PLUGIN_API addRef () override { return ++refs_; }
  uint32 PLUGIN_API release () override { const auto refs = --refs_; if (!refs) delete this; return refs; }
  tresult PLUGIN_API initialize (FUnknown*) override { return kResultOk; }
  tresult PLUGIN_API terminate () override { return kResultOk; }
  tresult PLUGIN_API getControllerClassId (TUID id) override { std::memcpy (id, synth_ ? kSynthCid : kEffectCid, 16); return kResultOk; }
  tresult PLUGIN_API setIoMode (IoMode) override { return kResultOk; }
  int32 PLUGIN_API getBusCount (MediaType type, BusDirection dir) override { return type == kAudio && (dir == kOutput || !synth_) ? 1 : (type == kEvent && dir == kInput && synth_ ? 1 : 0); }
  tresult PLUGIN_API getBusInfo (MediaType type, BusDirection dir, int32 index, BusInfo& info) override {
    if (index || getBusCount (type, dir) != 1) return kResultFalse;
    info = {}; info.mediaType = type; info.direction = dir; info.channelCount = type == kAudio ? 2 : 16; info.busType = kMain; info.flags = BusInfo::kDefaultActive; return kResultOk;
  }
  tresult PLUGIN_API getRoutingInfo (RoutingInfo&, RoutingInfo&) override { return kResultFalse; }
  tresult PLUGIN_API activateBus (MediaType, BusDirection, int32, TBool) override { return kResultOk; }
  tresult PLUGIN_API setActive (TBool) override { return kResultOk; }
  tresult PLUGIN_API getState (IBStream* stream) override { return writeValue (stream); }
  tresult PLUGIN_API setBusArrangements (SpeakerArrangement*, int32 ins, SpeakerArrangement*, int32 outs) override { return outs == 1 && (synth_ ? ins == 0 : ins == 1) ? kResultTrue : kResultFalse; }
  tresult PLUGIN_API getBusArrangement (BusDirection, int32 index, SpeakerArrangement& arrangement) override { if (index) return kResultFalse; arrangement = SpeakerArr::kStereo; return kResultOk; }
  tresult PLUGIN_API canProcessSampleSize (int32 size) override { return size == kSample32 ? kResultTrue : kResultFalse; }
  uint32 PLUGIN_API getLatencySamples () override { return 0; }
  tresult PLUGIN_API setupProcessing (ProcessSetup&) override { return kResultOk; }
  tresult PLUGIN_API setProcessing (TBool) override { return kResultOk; }
  tresult PLUGIN_API process (ProcessData& data) override {
    if (!data.outputs || !data.outputs[0].channelBuffers32) return kInvalidArgument;
    const bool playing = data.inputEvents && data.inputEvents->getEventCount () > 0;
    for (int channel = 0; channel < 2; ++channel) for (int i = 0; i < data.numSamples; ++i)
      data.outputs[0].channelBuffers32[channel][i] = synth_ ? (playing ? static_cast<float> (gain_) : 0.f) : (data.inputs && data.inputs[0].channelBuffers32 ? data.inputs[0].channelBuffers32[channel][i] * static_cast<float> (gain_) : 0.f);
    return kResultOk;
  }
  uint32 PLUGIN_API getTailSamples () override { return 0; }
  tresult PLUGIN_API setComponentState (IBStream* stream) override { return readValue (stream); }
  tresult PLUGIN_API setState (IBStream* stream) override { return readValue (stream); }
  int32 PLUGIN_API getParameterCount () override { return 1; }
  tresult PLUGIN_API getParameterInfo (int32 index, ParameterInfo& info) override { if (index) return kResultFalse; info = {}; info.id = kGainId; info.stepCount = 0; info.defaultNormalizedValue = .25; info.flags = ParameterInfo::kCanAutomate; std::u16string name = u"Gain"; std::copy (name.begin (), name.end (), info.title); return kResultOk; }
  tresult PLUGIN_API getParamStringByValue (ParamID, ParamValue, String128 text) override { text[0] = u'0'; text[1] = u'.'; text[2] = u'7'; text[3] = u'5'; text[4] = 0; return kResultOk; }
  tresult PLUGIN_API getParamValueByString (ParamID, TChar*, ParamValue&) override { return kResultFalse; }
  ParamValue PLUGIN_API normalizedParamToPlain (ParamID, ParamValue value) override { return value; }
  ParamValue PLUGIN_API plainParamToNormalized (ParamID, ParamValue value) override { return value; }
  ParamValue PLUGIN_API getParamNormalized (ParamID id) override { return id == kGainId ? gain_ : 0.; }
  tresult PLUGIN_API setParamNormalized (ParamID id, ParamValue value) override { if (id != kGainId) return kResultFalse; gain_ = std::clamp (value, 0., 1.); return kResultOk; }
  tresult PLUGIN_API setComponentHandler (IComponentHandler*) override { return kResultOk; }
  IPlugView* PLUGIN_API createView (FIDString) override { return nullptr; }
  tresult PLUGIN_API connect (IConnectionPoint*) override { return kResultOk; }
  tresult PLUGIN_API disconnect (IConnectionPoint*) override { return kResultOk; }
  tresult PLUGIN_API notify (IMessage*) override { return kResultOk; }
private:
  tresult writeValue (IBStream* stream) { int32 written = 0; return stream->write (&gain_, sizeof gain_, &written) == kResultOk && written == sizeof gain_ ? kResultOk : kResultFalse; }
  tresult readValue (IBStream* stream) { double value = 0.; int32 read = 0; if (stream->read (&value, sizeof value, &read) != kResultOk || read != sizeof value) return kResultFalse; gain_ = value; return kResultOk; }
  uint32 refs_ {1}; bool synth_; double gain_ {.25};
};

class Factory final : public IPluginFactory2 {
public:
  tresult PLUGIN_API queryInterface (const TUID iid, void** out) override { if (!out) return kInvalidArgument; *out = same (iid, INLINE_UID_OF(IPluginFactory2)) ? static_cast<IPluginFactory2*> (this) : static_cast<IPluginFactory*> (this); if (!*out) return kNoInterface; addRef (); return kResultOk; }
  uint32 PLUGIN_API addRef () override { return ++refs_; }
  uint32 PLUGIN_API release () override { return --refs_; }
  uint32 refs () const { return refs_; }
  tresult PLUGIN_API getFactoryInfo (PFactoryInfo* info) override { if (!info) return kInvalidArgument; *info = PFactoryInfo ("Fake", "", "", 0); return kResultOk; }
  int32 PLUGIN_API countClasses () override { return 2; }
  tresult PLUGIN_API getClassInfo (int32 index, PClassInfo* info) override { if (!info || index < 0 || index > 1) return kInvalidArgument; *info = PClassInfo (index ? kEffectCid : kSynthCid, PClassInfo::kManyInstances, kVstAudioEffectClass, index ? "Fake Effect" : "Fake Synth"); return kResultOk; }
  tresult PLUGIN_API getClassInfo2 (int32 index, PClassInfo2* info) override { if (!info || index < 0 || index > 1) return kInvalidArgument; *info = PClassInfo2 (index ? kEffectCid : kSynthCid, PClassInfo::kManyInstances, kVstAudioEffectClass, index ? "Fake Effect" : "Fake Synth", 0, index ? "Fx" : "Instrument|Synth", "Fake", "1", "3.8"); return kResultOk; }
  tresult PLUGIN_API createInstance (FIDString cid, FIDString iid, void** out) override { if (!out) return kInvalidArgument; *out = nullptr; if (!same (cid, kSynthCid) && !same (cid, kEffectCid)) return kInvalidArgument; auto* plugin = new Plugin (same (cid, kSynthCid)); const auto result = plugin->queryInterface (iid, out); plugin->release (); return result; }
private: uint32 refs_ {1};
};
inline Factory factory;
} // namespace fake_vst3

#ifdef PVST_DEFINE_FAKE_FACTORY
extern "C" Steinberg::IPluginFactory* PLUGIN_API GetPluginFactory () { fake_vst3::factory.addRef (); return &fake_vst3::factory; }
#endif
