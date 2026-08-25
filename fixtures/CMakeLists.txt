add_library(actual_vst3_fixture_factory STATIC
  bundle/plugin_factory.cpp
  instrument/instrument_component.cpp
  instrument/instrument_controller.cpp
  effect/effect_component.cpp
  effect/effect_controller.cpp
)
target_compile_features(actual_vst3_fixture_factory PRIVATE cxx_std_17)
target_include_directories(actual_vst3_fixture_factory PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/..
  ${PVST_VST3_SDK_DIR}
)
pvst_enable_sanitizers(actual_vst3_fixture_factory PRIVATE)
