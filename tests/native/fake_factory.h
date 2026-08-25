#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <prometheos/webvst.h>
#include <pluginterfaces/base/ibstream.h>
#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivsteditcontroller.h>
#include <pluginterfaces/vst/ivstevents.h>
#include <pluginterfaces/vst/ivsthostapplication.h>
#include <pluginterfaces/vst/ivstmessage.h>
#include <pluginterfaces/vst/ivstparameterchanges.h>

namespace fake_vst3 {
using namespace Steinberg;
using namespace Steinberg::Vst;

inline bool same (const TUID a, const TUID b) { return std::memcmp (a, b, 16) == 0; }
inline constexpr TUID kSynthCid = INLINE_UID (0x10203040, 0x50607080, 0x90A0B0C0, 0xD0E0F001);
inline constexpr TUID kEffectCid = INLINE_UID (0x10203041, 0x50607080, 0x90A0B0C0, 0xD0E0F002);
inline constexpr TUID kSynthControllerCid = INLINE_UID (0x20203040, 0x50607080, 0x90A0B0C0, 0xD0E0F101);
inline constexpr TUID kEffectControllerCid = INLINE_UID (0x20203041, 0x50607080, 0x90A0B0C0, 0xD0E0F102);
constexpr ParamID kGainId = 71;
constexpr ParamID kMixId = 72;

enum class FailurePoint {
  None,
  FactoryCreateComponent,
  ComponentInitialize,
  ProcessorQuery,
  FactoryCreateController,
  ControllerInitialize,
  ComponentConnect,
  ControllerConnect,
  InputBusCount,
  InputBusInfo,
  OutputBusCount,
  OutputBusInfo,
  BusArrangements,
  SampleSize,
  SetupProcessing,
  InputBusActivate,
  OutputBusActivate,
  ComponentActive,
  ProcessingStart,
  ProcessingStop,
  ComponentStateLoad,
  ControllerComponentStateLoad,
  ControllerStateLoad,
};

enum class Call {
  FactoryCreateComponent,
  ComponentInitialize,
  ProcessorQuery,
  ControllerClassId,
  FactoryCreateController,
  ControllerInitialize,
  ComponentConnectionQuery,
  ControllerConnectionQuery,
  ComponentConnect,
  ControllerConnect,
  InputBusCount,
  InputBusInfo,
  OutputBusCount,
  OutputBusInfo,
  BusArrangements,
  SampleSize,
  SetupProcessing,
  InputBusActivate,
  OutputBusActivate,
  ComponentActive,
  ProcessingStart,
  ProcessingStop,
  ComponentInactive,
  OutputBusDeactivate,
  InputBusDeactivate,
  ControllerDisconnect,
  ComponentDisconnect,
  ControllerTerminate,
  ComponentTerminate,
  ComponentStateLoad,
  ControllerComponentStateLoad,
  ControllerStateLoad,
};

struct ParameterObservation {
  ParamID id {};
  int32 point_count {};
  std::array<ParamValue, 64> values {};
};

struct FailureControl {
  FailurePoint fail_at {FailurePoint::None};
  bool combined_controller {};
  bool omit_component_connection {};
  bool omit_controller_connection {};
  bool invalid_utf16 {};
  int live_objects {};
  int component_initialize_successes {};
  int controller_initialize_successes {};
  int component_terminates {};
  int controller_terminates {};
  int controller_set_calls {};
  int process_calls {};
  int event_count {};
  std::array<Event, 64> events {};
  int parameter_queue_count {};
  int parameter_point_count {};
  std::array<ParameterObservation, 64> parameter_queues {};
  bool event_list_qi_ok {};
  bool parameter_changes_qi_ok {};
  bool parameter_queue_qi_ok {};
  std::array<Call, 256> calls {};
  size_t call_count {};

  void reset () { *this = {}; }
  void clear_process_observations () {
    process_calls = 0;
    event_count = 0;
    events = {};
    parameter_queue_count = 0;
    parameter_point_count = 0;
    parameter_queues = {};
    event_list_qi_ok = false;
    parameter_changes_qi_ok = false;
    parameter_queue_qi_ok = false;
  }
  void clear_calls () { calls = {}; call_count = 0; }
  void record (Call call) { if (call_count < calls.size ()) calls[call_count++] = call; }
  int count (Call wanted) const {
    int result = 0;
    for (size_t i = 0; i < call_count; ++i) result += calls[i] == wanted;
    return result;
  }
};
inline FailureControl failures;

enum class Role { Component, Controller };

class Plugin final : public IComponent, public IAudioProcessor, public IEditController, public IConnectionPoint {
public:
  Plugin (bool synth, Role role) : synth_ (synth), role_ (role) { ++failures.live_objects; }
  ~Plugin () { --failures.live_objects; }

  tresult PLUGIN_API queryInterface (const TUID iid, void** out) override {
    if (!out) return kInvalidArgument;
    *out = nullptr;
    if (same (iid, INLINE_UID_OF(FUnknown)))
      *out = role_ == Role::Component ? static_cast<void*> (static_cast<IComponent*> (this)) : static_cast<void*> (static_cast<IEditController*> (this));
    else if (same (iid, INLINE_UID_OF(IComponent)) && role_ == Role::Component)
      *out = static_cast<IComponent*> (this);
    else if (same (iid, INLINE_UID_OF(IAudioProcessor)) && role_ == Role::Component) {
      failures.record (Call::ProcessorQuery);
      if (failures.fail_at != FailurePoint::ProcessorQuery) *out = static_cast<IAudioProcessor*> (this);
    } else if (same (iid, INLINE_UID_OF(IEditController)) &&
               (role_ == Role::Controller || failures.combined_controller))
      *out = static_cast<IEditController*> (this);
    else if (same (iid, INLINE_UID_OF(IConnectionPoint))) {
      failures.record (role_ == Role::Component ? Call::ComponentConnectionQuery : Call::ControllerConnectionQuery);
      const bool omitted = role_ == Role::Component ? failures.omit_component_connection : failures.omit_controller_connection;
      if (!omitted) *out = static_cast<IConnectionPoint*> (this);
    }
    if (!*out) return kNoInterface;
    addRef ();
    return kResultOk;
  }
  uint32 PLUGIN_API addRef () override { return ++refs_; }
  uint32 PLUGIN_API release () override { const auto refs = --refs_; if (!refs) delete this; return refs; }
  tresult PLUGIN_API initialize (FUnknown*) override {
    const auto component = role_ == Role::Component;
    failures.record (component ? Call::ComponentInitialize : Call::ControllerInitialize);
    const auto fail = component ? FailurePoint::ComponentInitialize : FailurePoint::ControllerInitialize;
    if (failures.fail_at == fail) return kResultFalse;
    if (component) ++failures.component_initialize_successes; else ++failures.controller_initialize_successes;
    return kResultOk;
  }
  tresult PLUGIN_API terminate () override {
    const auto component = role_ == Role::Component;
    failures.record (component ? Call::ComponentTerminate : Call::ControllerTerminate);
    if (component) ++failures.component_terminates; else ++failures.controller_terminates;
    return kResultOk;
  }
  tresult PLUGIN_API getControllerClassId (TUID id) override {
    failures.record (Call::ControllerClassId);
    if (failures.combined_controller) return kResultFalse;
    std::memcpy (id, synth_ ? kSynthControllerCid : kEffectControllerCid, 16);
    return kResultOk;
  }
  tresult PLUGIN_API setIoMode (IoMode) override { return kResultOk; }
  int32 PLUGIN_API getBusCount (MediaType type, BusDirection dir) override {
    if (type != kAudio) return type == kEvent && dir == kInput && synth_ ? 1 : 0;
    failures.record (dir == kInput ? Call::InputBusCount : Call::OutputBusCount);
    if (dir == kInput && failures.fail_at == FailurePoint::InputBusCount) return 2;
    if (dir == kOutput && failures.fail_at == FailurePoint::OutputBusCount) return 0;
    return dir == kOutput || !synth_ ? 1 : 0;
  }
  tresult PLUGIN_API getBusInfo (MediaType type, BusDirection dir, int32 index, BusInfo& info) override {
    failures.record (dir == kInput ? Call::InputBusInfo : Call::OutputBusInfo);
    if ((dir == kInput && failures.fail_at == FailurePoint::InputBusInfo) ||
        (dir == kOutput && failures.fail_at == FailurePoint::OutputBusInfo)) return kResultFalse;
    if (index || getBusCountWithoutRecording (type, dir) != 1) return kResultFalse;
    info = {}; info.mediaType = type; info.direction = dir; info.channelCount = type == kAudio ? 2 : 16; info.busType = kMain; info.flags = BusInfo::kDefaultActive;
    return kResultOk;
  }
  tresult PLUGIN_API getRoutingInfo (RoutingInfo&, RoutingInfo&) override { return kResultFalse; }
  tresult PLUGIN_API activateBus (MediaType, BusDirection direction, int32, TBool state) override {
    if (state) {
      failures.record (direction == kInput ? Call::InputBusActivate : Call::OutputBusActivate);
      if ((direction == kInput && failures.fail_at == FailurePoint::InputBusActivate) ||
          (direction == kOutput && failures.fail_at == FailurePoint::OutputBusActivate)) return kResultFalse;
    } else failures.record (direction == kInput ? Call::InputBusDeactivate : Call::OutputBusDeactivate);
    return kResultOk;
  }
  tresult PLUGIN_API setActive (TBool state) override {
    failures.record (state ? Call::ComponentActive : Call::ComponentInactive);
    return state && failures.fail_at == FailurePoint::ComponentActive ? kResultFalse : kResultOk;
  }
  tresult PLUGIN_API getState (IBStream* stream) override {
    if (role_ == Role::Component) return writeDouble (stream, gain_);
    struct ControllerState { uint64_t marker; double gain; } state {0x4354524c53544154ull, gain_};
    int32 written = 0;
    return stream->write (&state, sizeof state, &written) == kResultOk && written == sizeof state ? kResultOk : kResultFalse;
  }
  tresult PLUGIN_API setBusArrangements (SpeakerArrangement*, int32 ins, SpeakerArrangement*, int32 outs) override {
    failures.record (Call::BusArrangements);
    if (failures.fail_at == FailurePoint::BusArrangements) return kResultFalse;
    return outs == 1 && (synth_ ? ins == 0 : ins == 1) ? kResultTrue : kResultFalse;
  }
  tresult PLUGIN_API getBusArrangement (BusDirection, int32 index, SpeakerArrangement& arrangement) override { if (index) return kResultFalse; arrangement = SpeakerArr::kStereo; return kResultOk; }
  tresult PLUGIN_API canProcessSampleSize (int32 size) override {
    failures.record (Call::SampleSize);
    return size == kSample32 && failures.fail_at != FailurePoint::SampleSize ? kResultTrue : kResultFalse;
  }
  uint32 PLUGIN_API getLatencySamples () override { return 0; }
  tresult PLUGIN_API setupProcessing (ProcessSetup&) override {
    failures.record (Call::SetupProcessing);
    return failures.fail_at == FailurePoint::SetupProcessing ? kResultFalse : kResultOk;
  }
  tresult PLUGIN_API setProcessing (TBool state) override {
    failures.record (state ? Call::ProcessingStart : Call::ProcessingStop);
    if ((state && failures.fail_at == FailurePoint::ProcessingStart) ||
        (!state && failures.fail_at == FailurePoint::ProcessingStop)) return kResultFalse;
    processing_ = state;
    return kResultOk;
  }
  tresult PLUGIN_API process (ProcessData& data) override {
    ++failures.process_calls;
    observeCallbacks (data);
    if (!data.outputs || !data.outputs[0].channelBuffers32) return kInvalidArgument;
    const bool playing = data.inputEvents && data.inputEvents->getEventCount () > 0;
    for (int channel = 0; channel < 2; ++channel) for (int i = 0; i < data.numSamples; ++i)
      data.outputs[0].channelBuffers32[channel][i] = synth_ ? (playing ? static_cast<float> (gain_) : 0.f) : (data.inputs && data.inputs[0].channelBuffers32 ? data.inputs[0].channelBuffers32[channel][i] * static_cast<float> (gain_) : 0.f);
    return kResultOk;
  }
  uint32 PLUGIN_API getTailSamples () override { return 0; }
  tresult PLUGIN_API setComponentState (IBStream* stream) override {
    failures.record (Call::ControllerComponentStateLoad);
    if (failures.fail_at == FailurePoint::ControllerComponentStateLoad) return kResultFalse;
    return readDouble (stream, gain_);
  }
  tresult PLUGIN_API setState (IBStream* stream) override {
    if (role_ == Role::Component) {
      failures.record (Call::ComponentStateLoad);
      if (failures.fail_at == FailurePoint::ComponentStateLoad) return kResultFalse;
      return readDouble (stream, gain_);
    }
    failures.record (Call::ControllerStateLoad);
    if (failures.fail_at == FailurePoint::ControllerStateLoad) return kResultFalse;
    struct ControllerState { uint64_t marker; double gain; } state {};
    int32 read = 0;
    if (stream->read (&state, sizeof state, &read) != kResultOk || read != sizeof state || state.marker != 0x4354524c53544154ull) return kResultFalse;
    gain_ = state.gain;
    return kResultOk;
  }
  int32 PLUGIN_API getParameterCount () override { return 2; }
  tresult PLUGIN_API getParameterInfo (int32 index, ParameterInfo& info) override {
    if (index < 0 || index > 1) return kResultFalse;
    info = {}; info.id = index == 0 ? kGainId : kMixId; info.stepCount = 0; info.defaultNormalizedValue = index == 0 ? .25 : .5; info.flags = ParameterInfo::kCanAutomate;
    if (failures.invalid_utf16) { info.title[0] = static_cast<TChar> (0xd800); return kResultOk; }
    constexpr char16_t gainTitle[] = u"G\u00e4in \U0001F39A";
    constexpr char16_t mixTitle[] = u"Mix";
    const auto* title = index == 0 ? gainTitle : mixTitle;
    std::copy (title, title + std::char_traits<char16_t>::length (title), info.title);
    return kResultOk;
  }
  tresult PLUGIN_API getParamStringByValue (ParamID id, ParamValue, String128 text) override {
    if (id != kGainId && id != kMixId) return kResultFalse;
    if (failures.invalid_utf16) { text[0] = static_cast<TChar> (0xdc00); text[1] = 0; return kResultOk; }
    constexpr char16_t valueText[] = u"\u00be\u00d7";
    std::copy (valueText, valueText + std::size (valueText), text);
    return kResultOk;
  }
  tresult PLUGIN_API getParamValueByString (ParamID, TChar*, ParamValue&) override { return kResultFalse; }
  ParamValue PLUGIN_API normalizedParamToPlain (ParamID, ParamValue value) override { return value; }
  ParamValue PLUGIN_API plainParamToNormalized (ParamID, ParamValue value) override { return value; }
  ParamValue PLUGIN_API getParamNormalized (ParamID id) override { return id == kGainId ? gain_ : id == kMixId ? mix_ : 0.; }
  tresult PLUGIN_API setParamNormalized (ParamID id, ParamValue value) override {
    ++failures.controller_set_calls;
    if (id == kGainId) gain_ = std::clamp (value, 0., 1.);
    else if (id == kMixId) mix_ = std::clamp (value, 0., 1.);
    else return kResultFalse;
    return kResultOk;
  }
  tresult PLUGIN_API setComponentHandler (IComponentHandler*) override { return kResultOk; }
  IPlugView* PLUGIN_API createView (FIDString) override { return nullptr; }
  tresult PLUGIN_API connect (IConnectionPoint*) override {
    failures.record (role_ == Role::Component ? Call::ComponentConnect : Call::ControllerConnect);
    const auto failure = role_ == Role::Component ? FailurePoint::ComponentConnect : FailurePoint::ControllerConnect;
    return failures.fail_at == failure ? kResultFalse : kResultOk;
  }
  tresult PLUGIN_API disconnect (IConnectionPoint*) override {
    failures.record (role_ == Role::Component ? Call::ComponentDisconnect : Call::ControllerDisconnect);
    return kResultOk;
  }
  tresult PLUGIN_API notify (IMessage*) override { return kResultOk; }

private:
  int32 getBusCountWithoutRecording (MediaType type, BusDirection dir) const { return type == kAudio && (dir == kOutput || !synth_) ? 1 : (type == kEvent && dir == kInput && synth_ ? 1 : 0); }
  static tresult writeDouble (IBStream* stream, double value) { int32 written = 0; return stream->write (&value, sizeof value, &written) == kResultOk && written == sizeof value ? kResultOk : kResultFalse; }
  static tresult readDouble (IBStream* stream, double& value) { int32 read = 0; return stream->read (&value, sizeof value, &read) == kResultOk && read == sizeof value ? kResultOk : kResultFalse; }
  static bool checkQi (FUnknown* object, const TUID iid) {
    void* queried = nullptr;
    if (!object || object->queryInterface (iid, &queried) != kResultOk || !queried) return false;
    return static_cast<FUnknown*> (queried)->release () == 1;
  }
  static void observeCallbacks (ProcessData& data) {
    failures.event_count = data.inputEvents ? std::min<int> (data.inputEvents->getEventCount (), 64) : 0;
    failures.event_list_qi_ok = checkQi (data.inputEvents, INLINE_UID_OF(IEventList)) && checkQi (data.inputEvents, INLINE_UID_OF(FUnknown));
    for (int index = 0; index < failures.event_count; ++index) data.inputEvents->getEvent (index, failures.events[index]);
    failures.parameter_queue_count = data.inputParameterChanges ? std::min<int> (data.inputParameterChanges->getParameterCount (), 64) : 0;
    failures.parameter_changes_qi_ok = checkQi (data.inputParameterChanges, INLINE_UID_OF(IParameterChanges)) && checkQi (data.inputParameterChanges, INLINE_UID_OF(FUnknown));
    failures.parameter_point_count = 0;
    failures.parameter_queue_qi_ok = failures.parameter_queue_count > 0;
    for (int queueIndex = 0; queueIndex < failures.parameter_queue_count; ++queueIndex) {
      auto* queue = data.inputParameterChanges->getParameterData (queueIndex);
      if (!queue) { failures.parameter_queue_qi_ok = false; continue; }
      failures.parameter_queue_qi_ok = failures.parameter_queue_qi_ok && checkQi (queue, INLINE_UID_OF(IParamValueQueue)) && checkQi (queue, INLINE_UID_OF(FUnknown));
      auto& observed = failures.parameter_queues[queueIndex];
      observed.id = queue->getParameterId (); observed.point_count = std::min<int> (queue->getPointCount (), 64); failures.parameter_point_count += observed.point_count;
      for (int pointIndex = 0; pointIndex < observed.point_count; ++pointIndex) { int32 offset = -1; queue->getPoint (pointIndex, offset, observed.values[pointIndex]); }
    }
  }

  uint32 refs_ {1};
  bool synth_;
  Role role_;
  bool processing_ {};
  double gain_ {.25};
  double mix_ {.5};
};

class Factory final : public IPluginFactory2 {
public:
  tresult PLUGIN_API queryInterface (const TUID iid, void** out) override {
    if (!out) return kInvalidArgument;
    *out = nullptr;
    if (same (iid, INLINE_UID_OF(IPluginFactory2))) *out = static_cast<IPluginFactory2*> (this);
    else if (same (iid, INLINE_UID_OF(IPluginFactory)) || same (iid, INLINE_UID_OF(FUnknown))) *out = static_cast<IPluginFactory*> (this);
    if (!*out) return kNoInterface;
    addRef (); return kResultOk;
  }
  uint32 PLUGIN_API addRef () override { return ++refs_; }
  uint32 PLUGIN_API release () override { return --refs_; }
  uint32 refs () const { return refs_; }
  tresult PLUGIN_API getFactoryInfo (PFactoryInfo* info) override { if (!info) return kInvalidArgument; *info = PFactoryInfo ("Fake", "", "", 0); return kResultOk; }
  int32 PLUGIN_API countClasses () override { return 4; }
  tresult PLUGIN_API getClassInfo (int32 index, PClassInfo* info) override {
    if (!info || index < 0 || index > 3) return kInvalidArgument;
    if (index == 0) *info = PClassInfo (kSynthCid, PClassInfo::kManyInstances, kVstAudioEffectClass, "Fake Synth");
    else if (index == 1) *info = PClassInfo (kEffectCid, PClassInfo::kManyInstances, kVstAudioEffectClass, "Fake Effect");
    else if (index == 2) *info = PClassInfo (kSynthControllerCid, PClassInfo::kManyInstances, kVstComponentControllerClass, "Fake Synth Controller");
    else *info = PClassInfo (kEffectControllerCid, PClassInfo::kManyInstances, kVstComponentControllerClass, "Fake Effect Controller");
    return kResultOk;
  }
  tresult PLUGIN_API getClassInfo2 (int32 index, PClassInfo2* info) override {
    if (!info || index < 0 || index > 3) return kInvalidArgument;
    PClassInfo base {}; getClassInfo (index, &base);
    *info = PClassInfo2 (base.cid, base.cardinality, base.category, base.name, 0, index == 0 ? "Instrument|Synth" : index == 1 ? "Fx" : "", "Fake", "1", "3.8");
    return kResultOk;
  }
  tresult PLUGIN_API createInstance (FIDString cid, FIDString iid, void** out) override {
    if (!out) return kInvalidArgument;
    *out = nullptr;
    const bool component = same (cid, kSynthCid) || same (cid, kEffectCid);
    const bool controller = same (cid, kSynthControllerCid) || same (cid, kEffectControllerCid);
    if (!component && !controller) return kInvalidArgument;
    failures.record (component ? Call::FactoryCreateComponent : Call::FactoryCreateController);
    if ((component && failures.fail_at == FailurePoint::FactoryCreateComponent) || (controller && failures.fail_at == FailurePoint::FactoryCreateController)) return kResultFalse;
    const bool synth = same (cid, kSynthCid) || same (cid, kSynthControllerCid);
    auto* plugin = new Plugin (synth, component ? Role::Component : Role::Controller);
    const auto result = plugin->queryInterface (iid, out);
    plugin->release ();
    return result;
  }
private: uint32 refs_ {1};
};
inline Factory factory;
} // namespace fake_vst3

#ifdef PVST_DEFINE_FAKE_FACTORY
extern "C" Steinberg::IPluginFactory* PLUGIN_API GetPluginFactory () { fake_vst3::factory.addRef (); return &fake_vst3::factory; }
#endif
