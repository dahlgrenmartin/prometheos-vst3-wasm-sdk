#pragma once
#include <stdint.h>

#if defined(__cplusplus)
extern "C" {
#endif

#define PVST_ABI_VERSION 1u
#define PVST_MAX_PROCESS_FRAMES 128u

enum pvst_result {
  PVST_OK = 0,
  PVST_ERROR_ARGUMENT = -1,
  PVST_ERROR_HANDLE = -2,
  PVST_ERROR_FRAME_COUNT = -3,
  PVST_ERROR_QUEUE_FULL = -4,
  PVST_ERROR_PLUGIN = -5,
  PVST_ERROR_BUFFER_TOO_SMALL = -6
};

enum pvst_parameter_flags {
  PVST_PARAMETER_AUTOMATABLE = 1u << 0,
  PVST_PARAMETER_READ_ONLY = 1u << 1
};

uint32_t pvst_abi_version(void);
uint32_t pvst_class_count(void);
uint32_t pvst_class_uid_size(uint32_t class_index);
int32_t pvst_class_uid_write(uint32_t class_index, char* dst, uint32_t capacity);
uint32_t pvst_class_name_size(uint32_t class_index);
int32_t pvst_class_name_write(uint32_t class_index, char* dst, uint32_t capacity);
uint32_t pvst_class_vendor_size(uint32_t class_index);
int32_t pvst_class_vendor_write(uint32_t class_index, char* dst, uint32_t capacity);
uint32_t pvst_class_kind(uint32_t class_index);
uint32_t pvst_class_param_count(uint32_t class_index);
uint32_t pvst_class_param_id(uint32_t class_index, uint32_t parameter_index);
uint32_t pvst_class_param_flags(uint32_t class_index, uint32_t parameter_index);
uint32_t pvst_class_param_step_count(uint32_t class_index, uint32_t parameter_index);
float pvst_class_param_default(uint32_t class_index, uint32_t parameter_index);
uint32_t pvst_class_param_title_size(uint32_t class_index, uint32_t parameter_index);
int32_t pvst_class_param_title_write(uint32_t class_index, uint32_t parameter_index, char* dst, uint32_t capacity);
uint32_t pvst_class_param_value_text_size(uint32_t class_index, uint32_t parameter_index, float normalized);
int32_t pvst_class_param_value_text_write(uint32_t class_index, uint32_t parameter_index, float normalized, char* dst, uint32_t capacity);

uint32_t pvst_create(uint32_t class_index, double sample_rate, uint32_t max_frames);
void pvst_destroy(uint32_t handle);
int32_t pvst_reset(uint32_t handle);
int32_t pvst_process(uint32_t handle, const float* input, float* output, uint32_t frames);
int32_t pvst_note_on(uint32_t handle, int32_t note, float velocity);
int32_t pvst_note_off(uint32_t handle, int32_t note);
float pvst_param_get(uint32_t handle, uint32_t parameter_id);
int32_t pvst_param_set(uint32_t handle, uint32_t parameter_id, float normalized);
uint32_t pvst_state_size(uint32_t handle);
int32_t pvst_state_write(uint32_t handle, uint8_t* dst, uint32_t capacity);
int32_t pvst_state_load(uint32_t handle, const uint8_t* src, uint32_t size);

#if defined(__cplusplus)
}
#endif
