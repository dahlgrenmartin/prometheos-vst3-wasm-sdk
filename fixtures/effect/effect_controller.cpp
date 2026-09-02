#include "effect_controller.h"
#include "fixtures/common/fixture_ids.h"

#include <algorithm>
#include <cstring>
#include <pluginterfaces/base/ibstream.h>

namespace webvst::fixtures {
using namespace Steinberg;
using namespace Steinberg::Vst;
namespace { bool same (const TUID lhs, const TUID rhs) { return FUnknownPrivate::iidEqual (lhs, rhs); } tresult read_value (IBStream* stream, ParamValue& value) { int32 read {}; return stream && stream->read (&value, sizeof value, &read) == kResultOk && read == sizeof value ? kResultOk : kResultFalse; } tresult write_value (IBStream* stream, ParamValue value) { int32 written {}; return stream && stream->write (&value, sizeof value, &written) == kResultOk && written == sizeof value ? kResultOk : kResultFalse; } }
FUnknown* EffectController::create_instance (void*) { return static_cast<IEditController*> (new EffectController); }
tresult PLUGIN_API EffectController::queryInterface (const TUID iid, void** out) { if (!out) return kInvalidArgument; *out = nullptr; if (same (iid, INLINE_UID_OF(FUnknown)) || same (iid, INLINE_UID_OF(IEditController))) *out = static_cast<IEditController*> (this); if (!*out) return kNoInterface; addRef (); return kResultOk; }
uint32 PLUGIN_API EffectController::addRef () { return ++refs_; } uint32 PLUGIN_API EffectController::release () { const auto refs = --refs_; if (!refs) delete this; return refs; }
tresult PLUGIN_API EffectController::initialize (FUnknown*) { return kResultOk; } tresult PLUGIN_API EffectController::terminate () { return kResultOk; }
tresult PLUGIN_API EffectController::setComponentState (IBStream* stream) { return read_value (stream, gain_); } tresult PLUGIN_API EffectController::setState (IBStream* stream) { return read_value (stream, gain_); } tresult PLUGIN_API EffectController::getState (IBStream* stream) { return write_value (stream, gain_); }
int32 PLUGIN_API EffectController::getParameterCount () { return 1; }
tresult PLUGIN_API EffectController::getParameterInfo (int32 index, ParameterInfo& info) { if (index != 0) return kResultFalse; info = {}; info.id = kEffectGainId; info.stepCount = 0; info.defaultNormalizedValue = .25; info.flags = ParameterInfo::kCanAutomate; constexpr TChar title[] = u"Effect Gain"; std::memcpy (info.title, title, sizeof title); return kResultOk; }
tresult PLUGIN_API EffectController::getParamStringByValue (ParamID id, ParamValue value, String128 text) { if (id != kEffectGainId) return kResultFalse; text[0] = static_cast<TChar> ('0' + static_cast<int> (std::clamp (value, 0., 1.) * 9.)); text[1] = 0; return kResultOk; }
tresult PLUGIN_API EffectController::getParamValueByString (ParamID, TChar*, ParamValue&) { return kResultFalse; } ParamValue PLUGIN_API EffectController::normalizedParamToPlain (ParamID, ParamValue value) { return value; } ParamValue PLUGIN_API EffectController::plainParamToNormalized (ParamID, ParamValue value) { return value; } ParamValue PLUGIN_API EffectController::getParamNormalized (ParamID id) { return id == kEffectGainId ? gain_ : 0.; } tresult PLUGIN_API EffectController::setParamNormalized (ParamID id, ParamValue value) { if (id != kEffectGainId) return kResultFalse; gain_ = std::clamp (value, 0., 1.); return kResultOk; } tresult PLUGIN_API EffectController::setComponentHandler (IComponentHandler*) { return kResultOk; } IPlugView* PLUGIN_API EffectController::createView (FIDString) { return nullptr; }
} // namespace webvst::fixtures
