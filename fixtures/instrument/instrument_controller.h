#pragma once

#include <pluginterfaces/vst/ivsteditcontroller.h>

namespace prometheos::fixtures {
class InstrumentController final : public Steinberg::Vst::IEditController {
public:
  static Steinberg::FUnknown* create_instance (void*);
  Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID iid, void** out) override;
  Steinberg::uint32 PLUGIN_API addRef () override;
  Steinberg::uint32 PLUGIN_API release () override;
  Steinberg::tresult PLUGIN_API initialize (Steinberg::FUnknown*) override;
  Steinberg::tresult PLUGIN_API terminate () override;
  Steinberg::tresult PLUGIN_API setComponentState (Steinberg::IBStream*) override;
  Steinberg::tresult PLUGIN_API setState (Steinberg::IBStream*) override;
  Steinberg::tresult PLUGIN_API getState (Steinberg::IBStream*) override;
  Steinberg::int32 PLUGIN_API getParameterCount () override;
  Steinberg::tresult PLUGIN_API getParameterInfo (Steinberg::int32, Steinberg::Vst::ParameterInfo&) override;
  Steinberg::tresult PLUGIN_API getParamStringByValue (Steinberg::Vst::ParamID, Steinberg::Vst::ParamValue, Steinberg::Vst::String128) override;
  Steinberg::tresult PLUGIN_API getParamValueByString (Steinberg::Vst::ParamID, Steinberg::Vst::TChar*, Steinberg::Vst::ParamValue&) override;
  Steinberg::Vst::ParamValue PLUGIN_API normalizedParamToPlain (Steinberg::Vst::ParamID, Steinberg::Vst::ParamValue) override;
  Steinberg::Vst::ParamValue PLUGIN_API plainParamToNormalized (Steinberg::Vst::ParamID, Steinberg::Vst::ParamValue) override;
  Steinberg::Vst::ParamValue PLUGIN_API getParamNormalized (Steinberg::Vst::ParamID) override;
  Steinberg::tresult PLUGIN_API setParamNormalized (Steinberg::Vst::ParamID, Steinberg::Vst::ParamValue) override;
  Steinberg::tresult PLUGIN_API setComponentHandler (Steinberg::Vst::IComponentHandler*) override;
  Steinberg::IPlugView* PLUGIN_API createView (Steinberg::FIDString) override;
private:
  Steinberg::uint32 refs_ {1};
  Steinberg::Vst::ParamValue gain_ {1.};
};
} // namespace prometheos::fixtures
