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
  set(_pvst_abi_header_ctest_template [=[
set(_pvst_abi_header_test_candidates
  "@CMAKE_CURRENT_BINARY_DIR@/abi_header_test@CMAKE_EXECUTABLE_SUFFIX@"
  "@CMAKE_CURRENT_BINARY_DIR@/Debug/abi_header_test@CMAKE_EXECUTABLE_SUFFIX@"
)
set(_pvst_abi_header_test_found FALSE)
foreach(_pvst_abi_header_test IN LISTS _pvst_abi_header_test_candidates)
  if(EXISTS "${_pvst_abi_header_test}")
    add_test(abi_header "${_pvst_abi_header_test}")
    set(_pvst_abi_header_test_found TRUE)
    break()
  endif()
endforeach()
if(NOT _pvst_abi_header_test_found)
  add_test(abi_header "@CMAKE_COMMAND@" -E false)
endif()
]=]
  )
  string(CONFIGURE "${_pvst_abi_header_ctest_template}"
    _pvst_abi_header_ctest_content @ONLY)
  file(GENERATE
    OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/abi_header_test_ctest.cmake"
    CONTENT "${_pvst_abi_header_ctest_content}"
  )
  set_property(DIRECTORY APPEND PROPERTY TEST_INCLUDE_FILES
    "${CMAKE_CURRENT_BINARY_DIR}/abi_header_test_ctest.cmake")
endif()
