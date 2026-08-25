#include "process_events.h"

#include <cstring>

namespace pvst {
using namespace Steinberg;
using namespace Steinberg::Vst;

tresult PLUGIN_API FixedEventList::queryInterface (const TUID iid, void** out) {
  if (!out) return kInvalidArgument;
  *out = nullptr;
  if (FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(IEventList)) || FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(FUnknown))) {
    *out = static_cast<IEventList*> (this);
    addRef ();
    return kResultOk;
  }
  return kNoInterface;
}

bool FixedEventList::note (bool on, int32_t pitch, float velocity) {
  if (count_ == static_cast<int32_t> (events_.size ())) return false;
  auto& event = events_[count_++];
  event = {};
  event.busIndex = 0;
  event.sampleOffset = 0;
  event.type = on ? Event::kNoteOnEvent : Event::kNoteOffEvent;
  if (on) {
    event.noteOn.channel = 0;
    event.noteOn.pitch = static_cast<int16> (pitch);
    event.noteOn.velocity = velocity;
    event.noteOn.noteId = -1;
  } else {
    event.noteOff.channel = 0;
    event.noteOff.pitch = static_cast<int16> (pitch);
    event.noteOff.velocity = velocity;
    event.noteOff.noteId = -1;
  }
  return true;
}

tresult PLUGIN_API FixedEventList::getEvent (int32 index, Event& event) {
  if (index < 0 || index >= count_) return kInvalidArgument;
  event = events_[index];
  return kResultOk;
}

tresult PLUGIN_API FixedEventList::addEvent (Event& event) {
  if (count_ == static_cast<int32> (events_.size ())) return kResultFalse;
  events_[count_++] = event;
  return kResultOk;
}

FixedParameterChanges::FixedParameterChanges () {
  for (auto& queue : queues_) queue.owner_ = this;
}

tresult PLUGIN_API FixedParameterChanges::queryInterface (const TUID iid, void** out) {
  if (!out) return kInvalidArgument;
  *out = nullptr;
  if (FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(IParameterChanges)) || FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(FUnknown))) {
    *out = static_cast<IParameterChanges*> (this);
    addRef ();
    return kResultOk;
  }
  return kNoInterface;
}

tresult PLUGIN_API FixedParameterChanges::Queue::queryInterface (const TUID iid, void** out) {
  if (!out) return kInvalidArgument;
  *out = nullptr;
  if (FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(IParamValueQueue)) || FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(FUnknown))) {
    *out = static_cast<IParamValueQueue*> (this);
    addRef ();
    return kResultOk;
  }
  return kNoInterface;
}

tresult PLUGIN_API FixedParameterChanges::Queue::getPoint (int32 index, int32& offset, ParamValue& result) {
  if (index < 0 || index >= point_count_) return kInvalidArgument;
  offset = points_[index].offset;
  result = points_[index].value;
  return kResultOk;
}

tresult PLUGIN_API FixedParameterChanges::Queue::addPoint (int32 offset, ParamValue value, int32& index) {
  return owner_ ? owner_->append_point (*this, offset, value, index) : kResultFalse;
}

int32 FixedParameterChanges::find_queue (ParamID id) const {
  for (int32 index = 0; index < queue_count_; ++index)
    if (queues_[index].id_ == id) return index;
  return -1;
}

void FixedParameterChanges::initialize_queue (int32 index, ParamID id) {
  queues_[index].id_ = id;
  queues_[index].point_count_ = 0;
}

bool FixedParameterChanges::reserve (ParamID id, Reservation& reservation) {
  reservation = {};
  reservation.queue_index = -1;
  if (point_count_ >= kCapacity) return false;
  auto index = find_queue (id);
  if (index < 0) {
    if (queue_count_ >= kCapacity) return false;
    index = queue_count_++;
    initialize_queue (index, id);
    reservation.created_queue = true;
  }
  ++point_count_;
  reservation.queue_index = index;
  return true;
}

void FixedParameterChanges::commit (Reservation& reservation, double value) {
  if (reservation.queue_index < 0) return;
  auto& queue = queues_[reservation.queue_index];
  queue.points_[queue.point_count_++] = {0, value};
  reservation.queue_index = -1;
  reservation.created_queue = false;
}

void FixedParameterChanges::cancel (Reservation& reservation) {
  if (reservation.queue_index < 0) return;
  --point_count_;
  if (reservation.created_queue) {
    --queue_count_;
    initialize_queue (queue_count_, 0);
  }
  reservation.queue_index = -1;
  reservation.created_queue = false;
}

bool FixedParameterChanges::push (ParamID id, double value) {
  Reservation reservation;
  if (!reserve (id, reservation)) return false;
  commit (reservation, value);
  return true;
}

void FixedParameterChanges::clear () {
  for (int32 index = 0; index < queue_count_; ++index) initialize_queue (index, 0);
  queue_count_ = 0;
  point_count_ = 0;
}

IParamValueQueue* PLUGIN_API FixedParameterChanges::getParameterData (int32 index) {
  return index < 0 || index >= queue_count_ ? nullptr : &queues_[index];
}

IParamValueQueue* PLUGIN_API FixedParameterChanges::addParameterData (const ParamID& id, int32& index) {
  index = find_queue (id);
  if (index >= 0) return &queues_[index];
  if (queue_count_ >= kCapacity) { index = -1; return nullptr; }
  index = queue_count_++;
  initialize_queue (index, id);
  return &queues_[index];
}

tresult FixedParameterChanges::append_point (Queue& queue, int32 offset, ParamValue value, int32& index) {
  if (point_count_ >= kCapacity || queue.point_count_ >= kCapacity) { index = -1; return kResultFalse; }
  index = queue.point_count_;
  queue.points_[queue.point_count_++] = {offset, value};
  ++point_count_;
  return kResultOk;
}
} // namespace pvst
