#ifndef WEBVST_WEBVST_UI_H
#define WEBVST_WEBVST_UI_H
#include <stdint.h>
#define WVUI_ABI_VERSION 1u
#define WVUI_ABI_NAME "webvst-ui-1"
// Matches the host bound: a configure event carries every parameter's metadata.
#define WVUI_MAX_EVENT_BYTES 1048576u
#ifdef __cplusplus
extern "C" {
#endif
uint32_t wvui_version(void);
uint32_t wvui_alloc(uint32_t bytes);
void wvui_free(uint32_t ptr, uint32_t bytes);
uint32_t wvui_create(void);
void wvui_destroy(uint32_t handle);
void wvui_resize(uint32_t handle, double width, double height, double scale);
void wvui_event(uint32_t handle, uint32_t ptr, uint32_t bytes);
void wvui_parameter(uint32_t handle, uint32_t id, double value);
void wvui_frame(uint32_t handle, double time_ms);
#ifdef __cplusplus
}
#endif
#endif
