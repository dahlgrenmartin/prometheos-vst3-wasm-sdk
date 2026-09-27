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
  ${WEBVST_VST3_SOURCE_DIR}
)
if(EMSCRIPTEN)
  target_compile_definitions(actual_vst3_fixture_factory PRIVATE __linux__=1)
endif()
webvst_enable_sanitizers(actual_vst3_fixture_factory PRIVATE)
