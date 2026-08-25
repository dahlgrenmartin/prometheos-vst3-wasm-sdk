#pragma once

#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivstcomponent.h>

namespace prometheos::fixtures {
class InstrumentComponent final : public Steinberg::Vst::IComponent, public Steinberg::Vst::IAudioProcessor {
public:
  static Steinberg::FUnknown* create_instance (void*);
  Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID iid, void** out) override;
  Steinberg::uint32 PLUGIN_API addRef () override;
  Steinberg::uint32 PLUGIN_API release () override;
  Steinberg::tresult PLUGIN_API initialize (Steinberg::FUnknown*) override;
  Steinberg::tresult PLUGIN_API terminate () override;
  Steinberg::tresult PLUGIN_API getControllerClassId (Steinberg::TUID id) override;
  Steinberg::tresult PLUGIN_API setIoMode (Steinberg::Vst::IoMode) override;
  Steinberg::int32 PLUGIN_API getBusCount (Steinberg::Vst::MediaType type, Steinberg::Vst::BusDirection direction) override;
  Steinberg::tresult PLUGIN_API getBusInfo (Steinberg::Vst::MediaType type, Steinberg::Vst::BusDirection direction, Steinberg::int32 index, Steinberg::Vst::BusInfo& info) override;
  Steinberg::tresult PLUGIN_API getRoutingInfo (Steinberg::Vst::RoutingInfo&, Steinberg::Vst::RoutingInfo&) override;
  Steinberg::tresult PLUGIN_API activateBus (Steinberg::Vst::MediaType, Steinberg::Vst::BusDirection, Steinberg::int32, Steinberg::TBool) override;
  Steinberg::tresult PLUGIN_API setActive (Steinberg::TBool) override;
  Steinberg::tresult PLUGIN_API setState (Steinberg::IBStream*) override;
  Steinberg::tresult PLUGIN_API getState (Steinberg::IBStream*) override;
  Steinberg::tresult PLUGIN_API setBusArrangements (Steinberg::Vst::SpeakerArrangement*, Steinberg::int32, Steinberg::Vst::SpeakerArrangement*, Steinberg::int32) override;
  Steinberg::tresult PLUGIN_API getBusArrangement (Steinberg::Vst::BusDirection, Steinberg::int32, Steinberg::Vst::SpeakerArrangement&) override;
  Steinberg::tresult PLUGIN_API canProcessSampleSize (Steinberg::int32) override;
  Steinberg::uint32 PLUGIN_API getLatencySamples () override;
  Steinberg::tresult PLUGIN_API setupProcessing (Steinberg::Vst::ProcessSetup&) override;
  Steinberg::tresult PLUGIN_API setProcessing (Steinberg::TBool) override;
  Steinberg::tresult PLUGIN_API process (Steinberg::Vst::ProcessData&) override;
  Steinberg::uint32 PLUGIN_API getTailSamples () override;
private:
  Steinberg::uint32 refs_ {1};
  double sample_rate_ {48000.};
  double phase_ {};
  double gain_ {1.};
  float velocity_ {};
  int note_ {69};
  bool playing_ {};
};
} // namespace prometheos::fixtures
