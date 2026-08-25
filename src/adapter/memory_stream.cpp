#include "memory_stream.h"
#include <algorithm>
#include <cstring>
namespace pvst {
MemoryStream::MemoryStream (const uint8_t* data, uint32_t size) : bytes_ (data, data + size) {}
Steinberg::tresult PLUGIN_API MemoryStream::queryInterface (const Steinberg::TUID iid, void** out) { if (!out) return Steinberg::kInvalidArgument; *out = nullptr; if (Steinberg::FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(Steinberg::IBStream)) || Steinberg::FUnknownPrivate::iidEqual (iid, INLINE_UID_OF(Steinberg::FUnknown))) { *out = this; addRef (); return Steinberg::kResultOk; } return Steinberg::kNoInterface; }
Steinberg::tresult PLUGIN_API MemoryStream::read (void* buffer, Steinberg::int32 count, Steinberg::int32* read) {
  if (!buffer || count < 0 || position_ > bytes_.size ()) return Steinberg::kInvalidArgument; const auto available = bytes_.size () - position_; const auto take = std::min<size_t> (available, count); if (take) std::memcpy (buffer, bytes_.data () + position_, take); position_ += take; if (read) *read = static_cast<Steinberg::int32> (take); return take == static_cast<size_t> (count) ? Steinberg::kResultOk : Steinberg::kResultFalse;
}
Steinberg::tresult PLUGIN_API MemoryStream::write (void* buffer, Steinberg::int32 count, Steinberg::int32* written) {
  if (!buffer || count < 0) return Steinberg::kInvalidArgument; const auto end = position_ + static_cast<size_t> (count); if (end > bytes_.size ()) bytes_.resize (end); std::memcpy (bytes_.data () + position_, buffer, count); position_ = end; if (written) *written = count; return Steinberg::kResultOk;
}
Steinberg::tresult PLUGIN_API MemoryStream::seek (Steinberg::int64 offset, Steinberg::int32 mode, Steinberg::int64* result) {
  Steinberg::int64 base = mode == kIBSeekSet ? 0 : mode == kIBSeekCur ? static_cast<Steinberg::int64> (position_) : mode == kIBSeekEnd ? static_cast<Steinberg::int64> (bytes_.size ()) : -1; if (base < 0 || offset < -base || offset > static_cast<Steinberg::int64> (bytes_.size ()) - base) return Steinberg::kInvalidArgument; position_ = static_cast<size_t> (base + offset); if (result) *result = position_; return Steinberg::kResultOk;
}
Steinberg::tresult PLUGIN_API MemoryStream::tell (Steinberg::int64* position) { if (!position) return Steinberg::kInvalidArgument; *position = position_; return Steinberg::kResultOk; }
} // namespace pvst
