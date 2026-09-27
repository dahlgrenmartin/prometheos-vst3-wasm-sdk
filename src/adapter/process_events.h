#pragma once

#include <array>
#include <pluginterfaces/vst/ivstevents.h>
#include <pluginterfaces/vst/ivstparameterchanges.h>

namespace webvst {
class FixedEventList final : public Steinberg::Vst::IEventList {
public:
  bool note (bool on, int32_t pitch, float velocity = 0.f);
  void clear () { count_ = 0; }
  Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID iid, void** out) override;
  Steinberg::uint32 PLUGIN_API addRef () override { return ++refs_; }
  Steinberg::uint32 PLUGIN_API release () override { return refs_ ? --refs_ : 0; }
  Steinberg::int32 PLUGIN_API getEventCount () override { return count_; }
  Steinberg::tresult PLUGIN_API getEvent (Steinberg::int32 index, Steinberg::Vst::Event& event) override;
  Steinberg::tresult PLUGIN_API addEvent (Steinberg::Vst::Event& event) override;

private:
  Steinberg::uint32 refs_ {1};
  std::array<Steinberg::Vst::Event, 64> events_ {};
  Steinberg::int32 count_ {0};
};

class FixedParameterChanges final : public Steinberg::Vst::IParameterChanges {
public:
  struct Reservation {
    Steinberg::int32 queue_index {-1};
    bool created_queue {};
  };

  FixedParameterChanges ();
  bool reserve (Steinberg::Vst::ParamID id, Reservation& reservation);
  void commit (Reservation& reservation, double value);
  void cancel (Reservation& reservation);
  bool push (Steinberg::Vst::ParamID id, double value);
  void clear ();
  Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID iid, void** out) override;
  Steinberg::uint32 PLUGIN_API addRef () override { return ++refs_; }
  Steinberg::uint32 PLUGIN_API release () override { return refs_ ? --refs_ : 0; }
  Steinberg::int32 PLUGIN_API getParameterCount () override { return queue_count_; }
  Steinberg::Vst::IParamValueQueue* PLUGIN_API getParameterData (Steinberg::int32 index) override;
  Steinberg::Vst::IParamValueQueue* PLUGIN_API addParameterData (const Steinberg::Vst::ParamID& id, Steinberg::int32& index) override;

private:
  static constexpr Steinberg::int32 kCapacity = 64;

  class Queue final : public Steinberg::Vst::IParamValueQueue {
  public:
    Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID iid, void** out) override;
    Steinberg::uint32 PLUGIN_API addRef () override { return ++refs_; }
    Steinberg::uint32 PLUGIN_API release () override { return refs_ ? --refs_ : 0; }
    Steinberg::Vst::ParamID PLUGIN_API getParameterId () override { return id_; }
    Steinberg::int32 PLUGIN_API getPointCount () override { return point_count_; }
    Steinberg::tresult PLUGIN_API getPoint (Steinberg::int32 index, Steinberg::int32& offset, Steinberg::Vst::ParamValue& result) override;
    Steinberg::tresult PLUGIN_API addPoint (Steinberg::int32 offset, Steinberg::Vst::ParamValue value, Steinberg::int32& index) override;

  private:
    friend class FixedParameterChanges;
    struct Point { Steinberg::int32 offset {}; Steinberg::Vst::ParamValue value {}; };
    FixedParameterChanges* owner_ {};
    Steinberg::uint32 refs_ {1};
    Steinberg::Vst::ParamID id_ {};
    std::array<Point, kCapacity> points_ {};
    Steinberg::int32 point_count_ {};
  };

  Steinberg::tresult append_point (Queue& queue, Steinberg::int32 offset, Steinberg::Vst::ParamValue value, Steinberg::int32& index);
  Steinberg::int32 find_queue (Steinberg::Vst::ParamID id) const;
  void initialize_queue (Steinberg::int32 index, Steinberg::Vst::ParamID id);

  Steinberg::uint32 refs_ {1};
  std::array<Queue, kCapacity> queues_ {};
  Steinberg::int32 queue_count_ {};
  Steinberg::int32 point_count_ {};
};
} // namespace webvst
