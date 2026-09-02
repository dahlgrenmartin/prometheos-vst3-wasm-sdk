#include "fixtures/common/fixture_ids.h"
#include "fixtures/effect/effect_component.h"
#include "fixtures/effect/effect_controller.h"
#include "fixtures/instrument/instrument_component.h"
#include "fixtures/instrument/instrument_controller.h"

#include <cstring>

namespace webvst::fixtures {
using namespace Steinberg;
using namespace Steinberg::Vst;
namespace {
bool same (const TUID lhs, const TUID rhs) { return FUnknownPrivate::iidEqual (lhs, rhs); }

class FixtureFactory final : public IPluginFactory2 {
public:
  tresult PLUGIN_API queryInterface (const TUID iid, void** out) override {
    if (!out) return kInvalidArgument;
    *out = nullptr;
    if (same (iid, INLINE_UID_OF(FUnknown)) || same (iid, INLINE_UID_OF(IPluginFactory))) *out = static_cast<IPluginFactory*> (this);
    else if (same (iid, INLINE_UID_OF(IPluginFactory2))) *out = static_cast<IPluginFactory2*> (this);
    if (!*out) return kNoInterface;
    addRef (); return kResultOk;
  }
  uint32 PLUGIN_API addRef () override { return ++refs_; }
  uint32 PLUGIN_API release () override { return --refs_; }
  tresult PLUGIN_API getFactoryInfo (PFactoryInfo* info) override {
    if (!info) return kInvalidArgument;
    *info = PFactoryInfo ("WebVST SDK", "", "", 0);
    return kResultOk;
  }
  int32 PLUGIN_API countClasses () override { return 4; }
  tresult PLUGIN_API getClassInfo (int32 index, PClassInfo* info) override {
    if (!info || index < 0 || index >= countClasses ()) return kInvalidArgument;
    switch (index) {
      case 0: *info = PClassInfo (kInstrumentComponentCid, PClassInfo::kManyInstances, kVstAudioEffectClass, "Fixture Instrument"); break;
      case 1: *info = PClassInfo (kEffectComponentCid, PClassInfo::kManyInstances, kVstAudioEffectClass, "Fixture Effect"); break;
      case 2: *info = PClassInfo (kInstrumentControllerCid, PClassInfo::kManyInstances, kVstComponentControllerClass, "Fixture Instrument Controller"); break;
      default: *info = PClassInfo (kEffectControllerCid, PClassInfo::kManyInstances, kVstComponentControllerClass, "Fixture Effect Controller"); break;
    }
    return kResultOk;
  }
  tresult PLUGIN_API getClassInfo2 (int32 index, PClassInfo2* info) override {
    if (!info || index < 0 || index >= countClasses ()) return kInvalidArgument;
    PClassInfo base {}; getClassInfo (index, &base);
    const char* subcategories = index == 0 ? "Instrument|Synth" : index == 1 ? "Fx" : "";
    *info = PClassInfo2 (base.cid, base.cardinality, base.category, base.name, 0, subcategories, "WebVST SDK", "1.0.0", "3.8.0");
    return kResultOk;
  }
  tresult PLUGIN_API createInstance (FIDString cid, FIDString iid, void** out) override {
    if (!out) return kInvalidArgument;
    *out = nullptr;
    FUnknown* instance {};
    if (same (cid, kInstrumentComponentCid)) instance = InstrumentComponent::create_instance (nullptr);
    else if (same (cid, kEffectComponentCid)) instance = EffectComponent::create_instance (nullptr);
    else if (same (cid, kInstrumentControllerCid)) instance = InstrumentController::create_instance (nullptr);
    else if (same (cid, kEffectControllerCid)) instance = EffectController::create_instance (nullptr);
    else return kNoInterface;
    const auto result = instance->queryInterface (iid, out);
    instance->release ();
    return result;
  }
private:
  uint32 refs_ {1};
};

FixtureFactory factory;
} // namespace
} // namespace webvst::fixtures

extern "C" Steinberg::IPluginFactory* PLUGIN_API GetPluginFactory () {
  webvst::fixtures::factory.addRef ();
  return &webvst::fixtures::factory;
}
