cmake_minimum_required(VERSION 3.20)

project(prometheos_vst3_wasm_sdk LANGUAGES C CXX)

option(PVST_BUILD_TESTS "Build native ABI tests" OFF)
set(PROMETHEOS_VST3_SDK_DIR "" CACHE PATH
  "Path to the exact VST3 SDK source directory")

add_library(prometheos_webvst_adapter INTERFACE)
target_include_directories(prometheos_webvst_adapter
  INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)

include(cmake/WebVstToolchain.cmake)

if(PVST_BUILD_TESTS)
  enable_testing()
  add_executable(abi_header_test tests/native/abi_header_test.cpp)
  target_compile_features(abi_header_test PRIVATE cxx_std_17)
  target_link_libraries(abi_header_test PRIVATE prometheos_webvst_adapter)
  add_test(NAME abi_header COMMAND abi_header_test)
endif()
