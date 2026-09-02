#pragma once
#include "vst3_instance.h"
#include <array>
#include <memory>
#include <webvst/webvst.h>
namespace webvst {
class Adapter {
public:
  uint32_t class_count () const; uint32_t class_uid_size (uint32_t index) const; int32_t class_uid_write (uint32_t index, char* dst, uint32_t capacity) const; uint32_t class_name_size (uint32_t index) const; int32_t class_name_write (uint32_t index, char* dst, uint32_t capacity) const; uint32_t class_vendor_size (uint32_t index) const; int32_t class_vendor_write (uint32_t index, char* dst, uint32_t capacity) const; uint32_t class_kind (uint32_t index) const;
  uint32_t class_param_count (uint32_t index) const; uint32_t class_param_id (uint32_t index, uint32_t parameter) const; uint32_t class_param_flags (uint32_t index, uint32_t parameter) const; uint32_t class_param_step_count (uint32_t index, uint32_t parameter) const; float class_param_default (uint32_t index, uint32_t parameter) const; uint32_t class_param_title_size (uint32_t index, uint32_t parameter) const; int32_t class_param_title_write (uint32_t index, uint32_t parameter, char* dst, uint32_t capacity) const; uint32_t class_param_value_text_size (uint32_t index, uint32_t parameter, float value) const; int32_t class_param_value_text_write (uint32_t index, uint32_t parameter, float value, char* dst, uint32_t capacity) const;
  uint32_t create (uint32_t index, double sample_rate, uint32_t frames); void destroy (uint32_t handle); int32_t reset (uint32_t handle); int32_t process (uint32_t handle, const float* in, float* out, uint32_t frames); int32_t note (uint32_t handle, bool on, int32_t note, float velocity); float param_get (uint32_t handle, uint32_t id); int32_t param_set (uint32_t handle, uint32_t id, float value); uint32_t state_size (uint32_t handle); int32_t state_write (uint32_t handle, uint8_t* dst, uint32_t capacity); int32_t state_load (uint32_t handle, const uint8_t* src, uint32_t size);
private:
  struct Slot { uint16_t generation {1}; std::unique_ptr<Vst3Instance> instance; }; static constexpr size_t kSlots = 32; Vst3Instance* instance (uint32_t handle) const; bool class_id (uint32_t visible_index, Steinberg::TUID id) const; bool parameter_info (uint32_t index, uint32_t parameter, Steinberg::Vst::ParameterInfo& info) const; std::array<Slot, kSlots> slots_ {};
};
Adapter& adapter ();
} // namespace webvst
