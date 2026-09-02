#include <webvst/webvst.h>
#include <type_traits>

static_assert(WEBVST_ABI_VERSION == 1u);
static_assert(std::is_same_v<decltype(&webvst_process),
  int32_t (*)(uint32_t, const float*, float*, uint32_t)>);
static_assert(std::is_same_v<decltype(&webvst_param_set),
  int32_t (*)(uint32_t, uint32_t, float)>);

int main() { return 0; }
