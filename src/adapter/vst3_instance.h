#pragma once
#include "process_events.h"
#include <array>
#include <memory>
#include <vector>
#include <prometheos/webvst.h>
#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivstcomponent.h>
#include <pluginterfaces/vst/ivsteditcontroller.h>
#include <pluginterfaces/vst/ivsthostapplication.h>
namespace pvst {
class Vst3Instance {
public:
  static std::unique_ptr<Vst3Instance> create (const Steinberg::TUID class_id, double sample_rate, uint32_t max_frames);
  ~Vst3Instance (); Vst3Instance (const Vst3Instance&) = delete;
  int32_t process (const float* input, float* output, uint32_t frames); int32_t reset ();
  int32_t note (bool on, int32_t note, float velocity); int32_t set_parameter (uint32_t id, float value); float get_parameter (uint32_t id) const;
  bool save_state (std::vector<uint8_t>& result); bool load_state (const uint8_t* data, uint32_t size);
  int32_t parameter_count () const; bool parameter_info (uint32_t index, Steinberg::Vst::ParameterInfo& info) const; bool parameter_value_text (uint32_t id, float value, Steinberg::Vst::String128 text) const;
private:
  class HostApplication final : public Steinberg::Vst::IHostApplication {
  public:
    Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID iid, void** out) override; Steinberg::uint32 PLUGIN_API addRef () override { return ++refs_; } Steinberg::uint32 PLUGIN_API release () override { return --refs_; }
    Steinberg::tresult PLUGIN_API getName (Steinberg::Vst::String128 name) override; Steinberg::tresult PLUGIN_API createInstance (Steinberg::TUID, Steinberg::TUID, void** out) override;
  private: Steinberg::uint32 refs_ {1};
  };
  Vst3Instance () = default; bool start (const Steinberg::TUID class_id, double sample_rate);
  void release (); static bool success (Steinberg::tresult result) { return result == Steinberg::kResultOk; }
  HostApplication host_; Steinberg::Vst::IComponent* component_ {nullptr}; Steinberg::Vst::IAudioProcessor* processor_ {nullptr}; Steinberg::Vst::IEditController* controller_ {nullptr}; Steinberg::Vst::IConnectionPoint* component_connection_ {nullptr}; Steinberg::Vst::IConnectionPoint* controller_connection_ {nullptr};
  std::array<float, 128> silence_ {}; std::array<Steinberg::Vst::Sample32*, 2> input_channels_ {}; std::array<Steinberg::Vst::Sample32*, 2> output_channels_ {}; std::array<Steinberg::Vst::AudioBusBuffers, 1> input_buses_ {}; std::array<Steinberg::Vst::AudioBusBuffers, 1> output_buses_ {}; FixedEventList events_; FixedParameterChanges parameters_; uint32_t max_frames_ {0}; bool has_input_ {false};
};
} // namespace pvst
