#pragma once
#include <array>
#include <pluginterfaces/vst/ivstevents.h>
#include <pluginterfaces/vst/ivstparameterchanges.h>
namespace pvst {
class FixedEventList final : public Steinberg::Vst::IEventList {
public:
  bool note (bool on, int32_t pitch, float velocity = 0.f); void clear () { count_ = 0; }
  Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID, void** out) override; Steinberg::uint32 PLUGIN_API addRef () override { return ++refs_; } Steinberg::uint32 PLUGIN_API release () override { return --refs_; }
  Steinberg::int32 PLUGIN_API getEventCount () override { return count_; } Steinberg::tresult PLUGIN_API getEvent (Steinberg::int32 index, Steinberg::Vst::Event& event) override; Steinberg::tresult PLUGIN_API addEvent (Steinberg::Vst::Event& event) override;
private: Steinberg::uint32 refs_ {1}; std::array<Steinberg::Vst::Event, 64> events_ {}; Steinberg::int32 count_ {0};
};
class FixedParameterChanges final : public Steinberg::Vst::IParameterChanges, public Steinberg::Vst::IParamValueQueue {
public:
  bool push (Steinberg::Vst::ParamID id, double value); void clear () { count_ = 0; }
  Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID, void** out) override; Steinberg::uint32 PLUGIN_API addRef () override { return ++refs_; } Steinberg::uint32 PLUGIN_API release () override { return --refs_; }
  Steinberg::int32 PLUGIN_API getParameterCount () override { return count_; } Steinberg::Vst::IParamValueQueue* PLUGIN_API getParameterData (Steinberg::int32 index) override; Steinberg::Vst::IParamValueQueue* PLUGIN_API addParameterData (const Steinberg::Vst::ParamID&, Steinberg::int32&) override { return nullptr; }
  Steinberg::Vst::ParamID PLUGIN_API getParameterId () override { return current_id_; } Steinberg::int32 PLUGIN_API getPointCount () override { return current_index_ < count_ ? 1 : 0; } Steinberg::tresult PLUGIN_API getPoint (Steinberg::int32, Steinberg::int32& offset, Steinberg::Vst::ParamValue& value) override; Steinberg::tresult PLUGIN_API addPoint (Steinberg::int32, Steinberg::Vst::ParamValue, Steinberg::int32&) override { return Steinberg::kResultFalse; }
private: Steinberg::uint32 refs_ {1}; std::array<Steinberg::Vst::ParamID, 64> ids_ {}; std::array<double, 64> values_ {}; Steinberg::int32 count_ {0}; Steinberg::int32 current_index_ {-1}; Steinberg::Vst::ParamID current_id_ {0};
};
} // namespace pvst
