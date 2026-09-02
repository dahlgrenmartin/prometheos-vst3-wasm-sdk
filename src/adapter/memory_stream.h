#pragma once

#include <cstdint>
#include <vector>
#include <pluginterfaces/base/ibstream.h>

namespace webvst {
class MemoryStream final : public Steinberg::IBStream {
public:
  MemoryStream () = default;
  explicit MemoryStream (const uint8_t* data, uint32_t size);
  const std::vector<uint8_t>& bytes () const { return bytes_; }
  void rewind () { position_ = 0; }
  Steinberg::tresult PLUGIN_API queryInterface (const Steinberg::TUID, void** out) override;
  Steinberg::uint32 PLUGIN_API addRef () override { return ++refs_; }
  Steinberg::uint32 PLUGIN_API release () override { return --refs_; }
  Steinberg::tresult PLUGIN_API read (void* buffer, Steinberg::int32 count, Steinberg::int32* read) override;
  Steinberg::tresult PLUGIN_API write (void* buffer, Steinberg::int32 count, Steinberg::int32* written) override;
  Steinberg::tresult PLUGIN_API seek (Steinberg::int64 offset, Steinberg::int32 mode, Steinberg::int64* result) override;
  Steinberg::tresult PLUGIN_API tell (Steinberg::int64* position) override;
private:
  Steinberg::uint32 refs_ {1}; std::vector<uint8_t> bytes_; size_t position_ {0};
};
} // namespace webvst
