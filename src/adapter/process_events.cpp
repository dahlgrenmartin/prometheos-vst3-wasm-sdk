#include "process_events.h"
#include <cstring>
namespace pvst {
Steinberg::tresult PLUGIN_API FixedEventList::queryInterface (const Steinberg::TUID, void** out) { if (out) *out = nullptr; return Steinberg::kNoInterface; }
bool FixedEventList::note (bool on, int32_t pitch, float velocity) { if (count_ == static_cast<int32_t> (events_.size ())) return false; auto& event = events_[count_++]; event = {}; event.busIndex = 0; event.sampleOffset = 0; event.type = on ? Steinberg::Vst::Event::kNoteOnEvent : Steinberg::Vst::Event::kNoteOffEvent; event.noteOn.channel = 0; event.noteOn.pitch = static_cast<Steinberg::int16> (pitch); event.noteOn.velocity = velocity; return true; }
Steinberg::tresult PLUGIN_API FixedEventList::getEvent (Steinberg::int32 index, Steinberg::Vst::Event& event) { if (index < 0 || index >= count_) return Steinberg::kInvalidArgument; event = events_[index]; return Steinberg::kResultOk; }
Steinberg::tresult PLUGIN_API FixedEventList::addEvent (Steinberg::Vst::Event& event) { if (count_ == static_cast<int32_t> (events_.size ())) return Steinberg::kResultFalse; events_[count_++] = event; return Steinberg::kResultOk; }
Steinberg::tresult PLUGIN_API FixedParameterChanges::queryInterface (const Steinberg::TUID, void** out) { if (out) *out = nullptr; return Steinberg::kNoInterface; }
bool FixedParameterChanges::push (Steinberg::Vst::ParamID id, double value) { if (count_ == static_cast<int32_t> (queues_.size ())) return false; queues_[count_].id = id; queues_[count_].value = value; ++count_; return true; }
Steinberg::Vst::IParamValueQueue* PLUGIN_API FixedParameterChanges::getParameterData (Steinberg::int32 index) { return index < 0 || index >= count_ ? nullptr : &queues_[index]; }
} // namespace pvst
