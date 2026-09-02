set(WEBVST_ADELAY_SOURCE_DIR
  "${WEBVST_VST3_PUBLIC_SDK_DIR}/samples/vst/adelay/source")

file(GENERATE
  OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/projectversion.h"
  CONTENT [=[
#pragma once
#define MAJOR_VERSION_STR "3"
#define MAJOR_VERSION_INT 3
#define SUB_VERSION_STR "8"
#define SUB_VERSION_INT 8
#define RELEASE_NUMBER_STR "1"
#define RELEASE_NUMBER_INT 1
#define BUILD_NUMBER_STR "84"
#define BUILD_NUMBER_INT 84
#define FULL_VERSION_STR "3.8.1.84"
#define VERSION_STR "3.8.1"
]=])

add_library(upstream_adelay_vst3_support STATIC
  ${WEBVST_VST3_SOURCE_DIR}/base/source/baseiids.cpp
  ${WEBVST_VST3_SOURCE_DIR}/base/source/fbuffer.cpp
  ${WEBVST_VST3_SOURCE_DIR}/base/source/fdebug.cpp
  ${WEBVST_VST3_SOURCE_DIR}/base/source/fobject.cpp
  ${WEBVST_VST3_SOURCE_DIR}/base/source/fstreamer.cpp
  ${WEBVST_VST3_SOURCE_DIR}/base/source/fstring.cpp
  ${WEBVST_VST3_SOURCE_DIR}/base/source/updatehandler.cpp
  ${WEBVST_VST3_SOURCE_DIR}/base/thread/source/flock.cpp
  ${WEBVST_VST3_SOURCE_DIR}/pluginterfaces/base/coreiids.cpp
  ${WEBVST_VST3_SOURCE_DIR}/pluginterfaces/base/funknown.cpp
  ${WEBVST_VST3_SOURCE_DIR}/pluginterfaces/base/ustring.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/utility/testing.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/vstaudioeffect.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/vstbus.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/vstcomponent.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/vstcomponentbase.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/vsteditcontroller.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/vstinitiids.cpp
  ${WEBVST_VST3_PUBLIC_SDK_DIR}/source/vst/vstparameters.cpp
)
target_compile_features(upstream_adelay_vst3_support PUBLIC cxx_std_17)
target_compile_definitions(upstream_adelay_vst3_support PUBLIC NO_PLUGUI=1)
target_include_directories(upstream_adelay_vst3_support PUBLIC
  ${WEBVST_VST3_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party
  ${CMAKE_CURRENT_BINARY_DIR}
)
set_target_properties(upstream_adelay_vst3_support PROPERTIES
  POSITION_INDEPENDENT_CODE ON)
# The sanitized adapter is linked into the same executables, and MSVC's address
# sanitizer changes the STL container annotations, so every object in the link
# must agree.
webvst_enable_sanitizers(upstream_adelay_vst3_support PRIVATE)

add_library(upstream_adelay_factory OBJECT
  ${WEBVST_ADELAY_SOURCE_DIR}/adelaycontroller.cpp
  ${WEBVST_ADELAY_SOURCE_DIR}/adelayprocessor.cpp
  ${WEBVST_ADELAY_SOURCE_DIR}/factory.cpp
)
target_compile_features(upstream_adelay_factory PRIVATE cxx_std_17)
target_compile_definitions(upstream_adelay_factory PRIVATE NO_PLUGUI=1)
target_include_directories(upstream_adelay_factory PRIVATE
  ${WEBVST_VST3_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party
  ${CMAKE_CURRENT_BINARY_DIR}
)
set_target_properties(upstream_adelay_factory PROPERTIES
  POSITION_INDEPENDENT_CODE ON)
webvst_enable_sanitizers(upstream_adelay_factory PRIVATE)

if(EMSCRIPTEN)
  target_compile_definitions(upstream_adelay_vst3_support PUBLIC __linux__=1 NDEBUG=1)
  target_compile_definitions(upstream_adelay_factory PRIVATE __linux__=1 NDEBUG=1)
else()
  add_library(steinberg_adelay_vst3 MODULE
    $<TARGET_OBJECTS:upstream_adelay_factory>)
  target_link_libraries(steinberg_adelay_vst3 PRIVATE upstream_adelay_vst3_support)
  set_target_properties(steinberg_adelay_vst3 PROPERTIES
    PREFIX ""
    OUTPUT_NAME "ADelay"
    SUFFIX ".vst3"
  )
endif()

if(WEBVST_BUILD_FIXTURES)
  add_executable(upstream_adelay_webvst
    ${CMAKE_CURRENT_SOURCE_DIR}/../../fixtures/bundle/wasm_entry.cpp
    $<TARGET_OBJECTS:upstream_adelay_factory>
  )
  target_link_libraries(upstream_adelay_webvst PRIVATE
    webvst_adapter upstream_adelay_vst3_support)
  webvst_configure_target(upstream_adelay_webvst)

  set(WEBVST_ADELAY_STAGING_DIR
    "${CMAKE_CURRENT_BINARY_DIR}/package-staging")
  set(WEBVST_ADELAY_PACKAGE
    "${CMAKE_CURRENT_SOURCE_DIR}/../../build/packages/steinberg-adelay.webvst")
  set_target_properties(upstream_adelay_webvst PROPERTIES
    SUFFIX ".wasm"
    RUNTIME_OUTPUT_DIRECTORY "${WEBVST_ADELAY_STAGING_DIR}"
    OUTPUT_NAME "plugin"
  )

  add_custom_target(upstream_adelay_webvst_package ALL
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVST_ADELAY_STAGING_DIR}"
    COMMAND ${CMAKE_COMMAND} -E make_directory
      "${CMAKE_CURRENT_SOURCE_DIR}/../../build/packages"
    COMMAND ${WEBVST_PNPM_EXECUTABLE} --dir "${CMAKE_CURRENT_SOURCE_DIR}/../../tools"
      run webvst -- manifest "$<TARGET_FILE:upstream_adelay_webvst>"
      org.webvst.conformance.steinberg-adelay 3.8.1 plugin.wasm
      "${WEBVST_ADELAY_STAGING_DIR}/plugin.json"
    COMMAND ${WEBVST_PNPM_EXECUTABLE} --dir "${CMAKE_CURRENT_SOURCE_DIR}/../../tools"
      run webvst -- pack "${WEBVST_ADELAY_STAGING_DIR}" "${WEBVST_ADELAY_PACKAGE}"
    BYPRODUCTS "${WEBVST_ADELAY_PACKAGE}"
    DEPENDS upstream_adelay_webvst
    VERBATIM
  )
endif()
