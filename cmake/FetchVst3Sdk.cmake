# Fetch the VST3 SDK at the revision used to validate this adapter.  The SDK
# is MIT licensed; its notice is recorded in the repository NOTICE.md.
include(FetchContent)
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()

set(WEBVST_VST3_SDK_REVISION "3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96")
set(_webvst_vst3_submodules pluginterfaces)
if(WEBVST_BUILD_TESTS OR WEBVST_BUILD_FIXTURES)
  list(APPEND _webvst_vst3_submodules base)
endif()

if(WEBVST_VST3_SDK_DIR)
  set(WEBVST_VST3_SOURCE_DIR "${WEBVST_VST3_SDK_DIR}")
else()
  FetchContent_Declare(vst3sdk
    GIT_REPOSITORY https://github.com/steinbergmedia/vst3sdk.git
    GIT_TAG ${WEBVST_VST3_SDK_REVISION}
    GIT_SHALLOW FALSE
    GIT_SUBMODULES ${_webvst_vst3_submodules}
    GIT_SUBMODULES_RECURSE FALSE
  )
  FetchContent_GetProperties(vst3sdk)
  if(NOT vst3sdk_POPULATED)
    FetchContent_Populate(vst3sdk)
  endif()
  set(WEBVST_VST3_SOURCE_DIR "${vst3sdk_SOURCE_DIR}")
endif()

set(WEBVST_VST3_PUBLIC_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/public.sdk")

if(NOT EXISTS "${WEBVST_VST3_SOURCE_DIR}/pluginterfaces/vst/ivstcomponent.h")
  message(FATAL_ERROR "WEBVST_VST3_SDK_DIR is not a VST3 SDK: ${WEBVST_VST3_SOURCE_DIR}")
endif()
if((WEBVST_BUILD_TESTS OR WEBVST_BUILD_FIXTURES) AND
   NOT EXISTS "${WEBVST_VST3_SOURCE_DIR}/base/source/fstreamer.h")
  message(FATAL_ERROR "The pinned VST3 base sources are missing: ${WEBVST_VST3_SOURCE_DIR}/base")
endif()
if((WEBVST_BUILD_TESTS OR WEBVST_BUILD_FIXTURES) AND
   NOT EXISTS "${WEBVST_VST3_PUBLIC_SDK_DIR}/samples/vst/adelay/source/factory.cpp")
  message(FATAL_ERROR "Initialize the pinned public.sdk submodule before configuring")
endif()
