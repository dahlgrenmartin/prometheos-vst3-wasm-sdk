# UI is independent of the DSP adapter and has no VST3 or browser dependency.
add_library(webvst_ui STATIC src/ui/ui.cpp)
target_include_directories(webvst_ui PUBLIC "${PROJECT_SOURCE_DIR}/include")
target_compile_features(webvst_ui PUBLIC cxx_std_17)

function(webvst_configure_ui target)
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "webvst_configure_ui requires Emscripten")
  endif()
  target_sources(${target} PRIVATE "${PROJECT_SOURCE_DIR}/src/ui/abi.cpp")
  target_link_libraries(${target} PRIVATE webvst_ui)
  target_compile_options(${target} PRIVATE -fno-exceptions -fno-rtti)
  target_link_options(${target} PRIVATE
    --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sMALLOC=emmalloc
    -sALLOW_MEMORY_GROWTH=0 -sASSERTIONS=0 -sINITIAL_MEMORY=16777216
    "-sEXPORTED_FUNCTIONS=['_wvui_version','_wvui_alloc','_wvui_free','_wvui_create','_wvui_destroy','_wvui_resize','_wvui_event','_wvui_parameter','_wvui_frame']")
  set_target_properties(${target} PROPERTIES SUFFIX ".wasm")
endfunction()

if(EMSCRIPTEN)
  target_compile_options(webvst_ui PRIVATE -fno-exceptions -fno-rtti)
  add_executable(webvst_ui_fixture fixtures/ui/editor.cpp)
  webvst_configure_ui(webvst_ui_fixture)
endif()
if(WEBVST_BUILD_TESTS AND NOT EMSCRIPTEN)
  add_executable(webvst_ui_tests tests/ui/toolkit_test.cpp)
  target_link_libraries(webvst_ui_tests PRIVATE webvst_ui)
  add_test(NAME webvst_ui COMMAND webvst_ui_tests)
endif()
