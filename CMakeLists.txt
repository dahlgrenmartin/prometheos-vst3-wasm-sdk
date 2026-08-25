cmake_minimum_required(VERSION 3.20)

project(prometheos_vst3_wasm_sdk LANGUAGES C CXX)

option(PVST_BUILD_TESTS "Build native ABI tests" OFF)
option(PVST_ENABLE_SANITIZERS "Enable address and undefined behavior sanitizers" OFF)
set(PROMETHEOS_VST3_SDK_DIR "" CACHE PATH
  "Path to the exact VST3 SDK source directory")

include(cmake/WebVstToolchain.cmake)
include(cmake/FetchVst3Sdk.cmake)

add_library(prometheos_webvst_adapter STATIC
  src/adapter/adapter.cpp
  src/adapter/vst3_instance.cpp
  src/adapter/process_events.cpp
  src/adapter/memory_stream.cpp
)
target_compile_features(prometheos_webvst_adapter PUBLIC cxx_std_17)
target_include_directories(prometheos_webvst_adapter
  PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  PRIVATE ${PVST_VST3_SDK_DIR}
)
if(PVST_ENABLE_SANITIZERS)
  if(MSVC)
    target_compile_options(prometheos_webvst_adapter PUBLIC /fsanitize=address)
    target_link_options(prometheos_webvst_adapter INTERFACE /INCREMENTAL:NO)
  elseif(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(prometheos_webvst_adapter PUBLIC -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(prometheos_webvst_adapter INTERFACE -fsanitize=address,undefined)
  endif()
endif()

if(PVST_BUILD_TESTS)
  enable_testing()
  add_executable(abi_header_test tests/native/abi_header_test.cpp)
  target_compile_features(abi_header_test PRIVATE cxx_std_17)
  target_link_libraries(abi_header_test PRIVATE prometheos_webvst_adapter)
  add_executable(webvst_adapter_tests
    tests/native/adapter_lifecycle_test.cpp
    tests/native/adapter_process_test.cpp
    tests/native/adapter_state_test.cpp
  )
  target_compile_features(webvst_adapter_tests PRIVATE cxx_std_17)
  target_include_directories(webvst_adapter_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/native ${PVST_VST3_SDK_DIR})
  target_link_libraries(webvst_adapter_tests PRIVATE prometheos_webvst_adapter)
  if(PVST_ENABLE_SANITIZERS AND MSVC)
    get_filename_component(_pvst_msvc_bin_dir "${CMAKE_CXX_COMPILER}" DIRECTORY)
    set(_pvst_asan_runtimes
      "${_pvst_msvc_bin_dir}/clang_rt.asan_dbg_dynamic-x86_64.dll"
      "${_pvst_msvc_bin_dir}/clang_rt.asan_dynamic-x86_64.dll")
    foreach(_pvst_sanitized_target abi_header_test webvst_adapter_tests)
      foreach(_pvst_asan_runtime IN LISTS _pvst_asan_runtimes)
        if(EXISTS "${_pvst_asan_runtime}")
        add_custom_command(TARGET ${_pvst_sanitized_target} POST_BUILD
          COMMAND ${CMAKE_COMMAND} -E copy_if_different "${_pvst_asan_runtime}"
            "$<TARGET_FILE_DIR:${_pvst_sanitized_target}>"
        )
        endif()
      endforeach()
    endforeach()
  endif()
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
  set(_pvst_adapter_ctest_template [=[
set(_pvst_adapter_test_candidates
  "@CMAKE_CURRENT_BINARY_DIR@/webvst_adapter_tests@CMAKE_EXECUTABLE_SUFFIX@"
  "@CMAKE_CURRENT_BINARY_DIR@/Debug/webvst_adapter_tests@CMAKE_EXECUTABLE_SUFFIX@"
)
foreach(_pvst_adapter_test IN LISTS _pvst_adapter_test_candidates)
  if(EXISTS "${_pvst_adapter_test}")
    add_test(webvst_adapter "${_pvst_adapter_test}")
    break()
  endif()
endforeach()
]=]
  )
  string(CONFIGURE "${_pvst_adapter_ctest_template}"
    _pvst_adapter_ctest_content @ONLY)
  file(GENERATE
    OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/webvst_adapter_ctest.cmake"
    CONTENT "${_pvst_adapter_ctest_content}"
  )
  set_property(DIRECTORY APPEND PROPERTY TEST_INCLUDE_FILES
    "${CMAKE_CURRENT_BINARY_DIR}/webvst_adapter_ctest.cmake")
endif()
