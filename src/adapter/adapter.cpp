#include "adapter.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <pluginterfaces/base/ipluginbase.h>
extern "C" Steinberg::IPluginFactory* PLUGIN_API GetPluginFactory ();
namespace webvst {
using namespace Steinberg; using namespace Steinberg::Vst;
namespace {
bool audio_class (IPluginFactory* factory, int32 raw, PClassInfo& info) { return factory && factory->getClassInfo (raw, &info) == kResultOk && std::strcmp (info.category, kVstAudioEffectClass) == 0; }
uint32_t write_text (const char* text, char* dst, uint32_t capacity) { const auto size = static_cast<uint32_t> (std::strlen (text)); if (!dst || capacity < size) return 0; std::memcpy (dst, text, size); return size; }
uint32_t size_text (const char* text) { return text ? static_cast<uint32_t> (std::strlen (text)) : 0; }

struct Utf8Text {
  std::array<char, 513> bytes {};
  uint32_t size {};
};

bool utf16_to_utf8 (const TChar* source, uint32_t capacity, Utf8Text& result) {
  result = {};
  for (uint32_t index = 0; index < capacity; ++index) {
    uint32_t codepoint = static_cast<uint16_t> (source[index]);
    if (codepoint == 0) {
      return true;
    }
    if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
      if (++index >= capacity) return false;
      const auto low = static_cast<uint16_t> (source[index]);
      if (low < 0xdc00 || low > 0xdfff) return false;
      codepoint = 0x10000u + ((codepoint - 0xd800u) << 10u) + (low - 0xdc00u);
    } else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) {
      return false;
    }

    const auto remaining = result.bytes.size () - result.size;
    if (codepoint <= 0x7f) {
      if (remaining < 1) return false;
      result.bytes[result.size++] = static_cast<char> (codepoint);
    } else if (codepoint <= 0x7ff) {
      if (remaining < 2) return false;
      result.bytes[result.size++] = static_cast<char> (0xc0u | (codepoint >> 6u));
      result.bytes[result.size++] = static_cast<char> (0x80u | (codepoint & 0x3fu));
    } else if (codepoint <= 0xffff) {
      if (remaining < 3) return false;
      result.bytes[result.size++] = static_cast<char> (0xe0u | (codepoint >> 12u));
      result.bytes[result.size++] = static_cast<char> (0x80u | ((codepoint >> 6u) & 0x3fu));
      result.bytes[result.size++] = static_cast<char> (0x80u | (codepoint & 0x3fu));
    } else {
      if (remaining < 4) return false;
      result.bytes[result.size++] = static_cast<char> (0xf0u | (codepoint >> 18u));
      result.bytes[result.size++] = static_cast<char> (0x80u | ((codepoint >> 12u) & 0x3fu));
      result.bytes[result.size++] = static_cast<char> (0x80u | ((codepoint >> 6u) & 0x3fu));
      result.bytes[result.size++] = static_cast<char> (0x80u | (codepoint & 0x3fu));
    }
  }
  return false;
}
}
Adapter& adapter () { static Adapter value; return value; }
uint32_t Adapter::class_count () const { auto* factory = GetPluginFactory (); if (!factory) return 0; uint32_t count = 0; for (int32 raw = 0; raw < factory->countClasses (); ++raw) { PClassInfo info {}; if (audio_class (factory, raw, info)) ++count; } factory->release (); return count; }
bool Adapter::class_id (uint32_t visible, TUID id) const { auto* factory = GetPluginFactory (); if (!factory) return false; uint32_t seen = 0; bool found = false; for (int32 raw = 0; raw < factory->countClasses (); ++raw) { PClassInfo info {}; if (audio_class (factory, raw, info) && seen++ == visible) { std::memcpy (id, info.cid, 16); found = true; break; } } factory->release (); return found; }
uint32_t Adapter::class_uid_size (uint32_t index) const { TUID id {}; return class_id (index, id) ? 32u : 0u; }
int32_t Adapter::class_uid_write (uint32_t index, char* dst, uint32_t cap) const { TUID id {}; if (!class_id (index, id)) return WEBVST_ERROR_ARGUMENT; if (!dst || cap < 32) return WEBVST_ERROR_BUFFER_TOO_SMALL; constexpr char hex[] = "0123456789abcdef"; for (uint32_t i = 0; i < 16; ++i) { const auto byte = static_cast<unsigned char> (id[i]); dst[i * 2] = hex[byte >> 4u]; dst[i * 2 + 1] = hex[byte & 0x0fu]; } return WEBVST_OK; }
uint32_t Adapter::class_name_size (uint32_t index) const { auto* f = GetPluginFactory (); if (!f) return 0; uint32_t seen=0, result=0; for (int32 i=0;i<f->countClasses ();++i) { PClassInfo info {}; if (audio_class(f,i,info) && seen++ == index) { result=size_text(info.name); break; } } f->release (); return result; }
int32_t Adapter::class_name_write (uint32_t index, char* dst, uint32_t cap) const { auto* f = GetPluginFactory (); if (!f) return WEBVST_ERROR_ARGUMENT; uint32_t seen=0; int32_t result=WEBVST_ERROR_ARGUMENT; for (int32 i=0;i<f->countClasses ();++i) { PClassInfo info {}; if (audio_class(f,i,info) && seen++ == index) { result=write_text(info.name,dst,cap) ? WEBVST_OK : WEBVST_ERROR_BUFFER_TOO_SMALL; break; } } f->release (); return result; }
uint32_t Adapter::class_vendor_size (uint32_t index) const { TUID id {}; if (!class_id(index, id)) return 0; auto* f=GetPluginFactory (); PFactoryInfo info {}; const auto result=f && f->getFactoryInfo(&info)==kResultOk ? size_text(info.vendor) : 0; if(f)f->release(); return result; }
int32_t Adapter::class_vendor_write (uint32_t index, char* dst, uint32_t cap) const { TUID id {}; if (!class_id(index,id)) return WEBVST_ERROR_ARGUMENT; PFactoryInfo info {}; auto* f=GetPluginFactory (); const auto result=f && f->getFactoryInfo(&info)==kResultOk && write_text(info.vendor,dst,cap) ? WEBVST_OK : WEBVST_ERROR_BUFFER_TOO_SMALL; if(f)f->release(); return result; }
uint32_t Adapter::class_kind (uint32_t index) const { TUID id {}; if (!class_id(index,id)) return 0; auto* f=GetPluginFactory (); IPluginFactory2* f2=nullptr; if (!f || f->queryInterface(INLINE_UID_OF(IPluginFactory2),reinterpret_cast<void**>(&f2))!=kResultOk || !f2) { if(f)f->release(); return 0; } uint32_t seen=0, result=0; for(int32 i=0;i<f2->countClasses();++i){PClassInfo x{};if(audio_class(f2,i,x)&&seen++==index){PClassInfo2 info{};if(f2->getClassInfo2(i,&info)==kResultOk&&std::strstr(info.subCategories,"Instrument"))result=1;break;}} f2->release(); f->release(); return result; }
bool Adapter::parameter_info (uint32_t index, uint32_t parameter, ParameterInfo& info) const { TUID id {}; auto value = class_id(index,id) ? Vst3Instance::create(id,48000.,128) : nullptr; return value && value->parameter_info(parameter,info); }
uint32_t Adapter::class_param_count (uint32_t index) const { TUID id {}; auto value = class_id(index,id) ? Vst3Instance::create(id,48000.,128) : nullptr; return value ? static_cast<uint32_t>(std::max(0,value->parameter_count())) : 0; }
uint32_t Adapter::class_param_id (uint32_t index,uint32_t parameter) const { ParameterInfo info{}; return parameter_info(index,parameter,info)?info.id:0; }
uint32_t Adapter::class_param_flags (uint32_t index,uint32_t parameter) const { ParameterInfo info{}; if(!parameter_info(index,parameter,info))return 0; return (info.flags&ParameterInfo::kCanAutomate?WEBVST_PARAMETER_AUTOMATABLE:0)|(info.flags&ParameterInfo::kIsReadOnly?WEBVST_PARAMETER_READ_ONLY:0); }
uint32_t Adapter::class_param_step_count (uint32_t index,uint32_t parameter) const { ParameterInfo info{}; return parameter_info(index,parameter,info)?static_cast<uint32_t>(info.stepCount):0; }
float Adapter::class_param_default (uint32_t index,uint32_t parameter) const { ParameterInfo info{}; return parameter_info(index,parameter,info)?static_cast<float>(info.defaultNormalizedValue):0.f; }
uint32_t Adapter::class_param_title_size (uint32_t index,uint32_t parameter) const { ParameterInfo info{}; Utf8Text text; return parameter_info(index,parameter,info) && utf16_to_utf8(info.title,128,text) ? text.size : 0; }
int32_t Adapter::class_param_title_write(uint32_t index,uint32_t parameter,char*dst,uint32_t cap)const{ParameterInfo info{};if(!parameter_info(index,parameter,info))return WEBVST_ERROR_ARGUMENT;Utf8Text text;if(!utf16_to_utf8(info.title,128,text))return WEBVST_ERROR_PLUGIN;if(!dst||cap<text.size)return WEBVST_ERROR_BUFFER_TOO_SMALL;std::memcpy(dst,text.bytes.data(),text.size);return WEBVST_OK;}
uint32_t Adapter::class_param_value_text_size (uint32_t index, uint32_t parameter, float value) const { ParameterInfo info {}; TUID id {}; if (!std::isfinite (value) || !parameter_info (index, parameter, info) || !class_id (index, id)) return 0; auto instance = Vst3Instance::create (id, 48000., 128); String128 source {}; Utf8Text text; return instance && instance->parameter_value_text (info.id, value, source) && utf16_to_utf8(source,128,text) ? text.size : 0; }
int32_t Adapter::class_param_value_text_write (uint32_t index, uint32_t parameter, float value, char* dst, uint32_t capacity) const { ParameterInfo info {}; TUID id {}; if (!std::isfinite (value) || !parameter_info (index, parameter, info) || !class_id (index, id)) return WEBVST_ERROR_ARGUMENT; auto instance = Vst3Instance::create (id, 48000., 128); String128 source {}; Utf8Text text; if (!instance || !instance->parameter_value_text (info.id, value, source) || !utf16_to_utf8(source,128,text)) return WEBVST_ERROR_PLUGIN; if (!dst || capacity < text.size) return WEBVST_ERROR_BUFFER_TOO_SMALL; std::memcpy(dst,text.bytes.data(),text.size); return WEBVST_OK; }
uint32_t Adapter::create(uint32_t index,double rate,uint32_t frames){TUID id{};if(!class_id(index,id)||!std::isfinite(rate)||rate<=0||frames==0||frames>WEBVST_MAX_PROCESS_FRAMES)return 0;for(uint32_t i=0;i<kSlots;++i)if(!slots_[i].instance){auto instance=Vst3Instance::create(id,rate,frames);if(!instance)return 0;slots_[i].instance=std::move(instance);return(static_cast<uint32_t>(slots_[i].generation)<<16)|(i+1);}return 0;}
Vst3Instance* Adapter::instance(uint32_t handle)const{const uint32_t raw=handle&0xffffu;const uint16_t generation=static_cast<uint16_t>(handle>>16);if(!raw||raw>kSlots||!generation)return nullptr;const auto&slot=slots_[raw-1];return slot.generation==generation?slot.instance.get():nullptr;}
void Adapter::destroy(uint32_t handle){const uint32_t raw=handle&0xffffu;auto*value=instance(handle);if(!value)return;auto&slot=slots_[raw-1];slot.instance.reset();if(++slot.generation==0)++slot.generation;}
int32_t Adapter::reset(uint32_t handle){auto*v=instance(handle);return v?v->reset():WEBVST_ERROR_HANDLE;} int32_t Adapter::process(uint32_t h,const float*i,float*o,uint32_t n){auto*v=instance(h);return v?v->process(i,o,n):WEBVST_ERROR_HANDLE;}int32_t Adapter::note(uint32_t h,bool on,int32_t n,float velocity){auto*v=instance(h);return v?v->note(on,n,velocity):WEBVST_ERROR_HANDLE;}float Adapter::param_get(uint32_t h,uint32_t id){auto*v=instance(h);return v?v->get_parameter(id):0.f;}int32_t Adapter::param_set(uint32_t h,uint32_t id,float value){auto*v=instance(h);return v?v->set_parameter(id,value):WEBVST_ERROR_HANDLE;}
uint32_t Adapter::state_size(uint32_t h){auto*v=instance(h);if(!v)return 0;std::vector<uint8_t>b;return v->save_state(b)?static_cast<uint32_t>(b.size()):0;}int32_t Adapter::state_write(uint32_t h,uint8_t*dst,uint32_t cap){auto*v=instance(h);if(!v)return WEBVST_ERROR_HANDLE;std::vector<uint8_t>b;if(!v->save_state(b))return WEBVST_ERROR_PLUGIN;if(!dst||cap<b.size())return WEBVST_ERROR_BUFFER_TOO_SMALL;std::memcpy(dst,b.data(),b.size());return WEBVST_OK;}int32_t Adapter::state_load(uint32_t h,const uint8_t*src,uint32_t size){auto*v=instance(h);return v?v->load_state(src,size):WEBVST_ERROR_HANDLE;}
} // namespace webvst

extern "C" {
uint32_t webvst_abi_version(void){return WEBVST_ABI_VERSION;}uint32_t webvst_class_count(void){return webvst::adapter().class_count();}uint32_t webvst_class_uid_size(uint32_t i){return webvst::adapter().class_uid_size(i);}int32_t webvst_class_uid_write(uint32_t i,char*d,uint32_t c){return webvst::adapter().class_uid_write(i,d,c);}uint32_t webvst_class_name_size(uint32_t i){return webvst::adapter().class_name_size(i);}int32_t webvst_class_name_write(uint32_t i,char*d,uint32_t c){return webvst::adapter().class_name_write(i,d,c);}uint32_t webvst_class_vendor_size(uint32_t i){return webvst::adapter().class_vendor_size(i);}int32_t webvst_class_vendor_write(uint32_t i,char*d,uint32_t c){return webvst::adapter().class_vendor_write(i,d,c);}uint32_t webvst_class_kind(uint32_t i){return webvst::adapter().class_kind(i);}uint32_t webvst_class_param_count(uint32_t i){return webvst::adapter().class_param_count(i);}uint32_t webvst_class_param_id(uint32_t i,uint32_t p){return webvst::adapter().class_param_id(i,p);}uint32_t webvst_class_param_flags(uint32_t i,uint32_t p){return webvst::adapter().class_param_flags(i,p);}uint32_t webvst_class_param_step_count(uint32_t i,uint32_t p){return webvst::adapter().class_param_step_count(i,p);}float webvst_class_param_default(uint32_t i,uint32_t p){return webvst::adapter().class_param_default(i,p);}uint32_t webvst_class_param_title_size(uint32_t i,uint32_t p){return webvst::adapter().class_param_title_size(i,p);}int32_t webvst_class_param_title_write(uint32_t i,uint32_t p,char*d,uint32_t c){return webvst::adapter().class_param_title_write(i,p,d,c);}uint32_t webvst_class_param_value_text_size(uint32_t i,uint32_t p,float v){return webvst::adapter().class_param_value_text_size(i,p,v);}int32_t webvst_class_param_value_text_write(uint32_t i,uint32_t p,float v,char*d,uint32_t c){return webvst::adapter().class_param_value_text_write(i,p,v,d,c);}uint32_t webvst_create(uint32_t i,double r,uint32_t f){return webvst::adapter().create(i,r,f);}void webvst_destroy(uint32_t h){webvst::adapter().destroy(h);}int32_t webvst_reset(uint32_t h){return webvst::adapter().reset(h);}int32_t webvst_process(uint32_t h,const float*i,float*o,uint32_t n){return webvst::adapter().process(h,i,o,n);}int32_t webvst_note_on(uint32_t h,int32_t n,float v){return webvst::adapter().note(h,true,n,v);}int32_t webvst_note_off(uint32_t h,int32_t n){return webvst::adapter().note(h,false,n,0.f);}float webvst_param_get(uint32_t h,uint32_t i){return webvst::adapter().param_get(h,i);}int32_t webvst_param_set(uint32_t h,uint32_t i,float v){return webvst::adapter().param_set(h,i,v);}uint32_t webvst_state_size(uint32_t h){return webvst::adapter().state_size(h);}int32_t webvst_state_write(uint32_t h,uint8_t*d,uint32_t c){return webvst::adapter().state_write(h,d,c);}int32_t webvst_state_load(uint32_t h,const uint8_t*s,uint32_t z){return webvst::adapter().state_load(h,s,z);}
}
