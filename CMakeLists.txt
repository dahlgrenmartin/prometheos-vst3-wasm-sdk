cmake_minimum_required(VERSION 3.20)

project(webvst_vst3_wasm_sdk LANGUAGES C CXX)

option(WEBVST_BUILD_TESTS "Build native ABI tests" OFF)
option(WEBVST_BUILD_FIXTURES "Build the Emscripten WebVST conformance fixture package" OFF)
option(WEBVST_ENABLE_SANITIZERS "Enable address and undefined behavior sanitizers" OFF)
set(WEBVST_VST3_SDK_DIR "" CACHE PATH
  "Path to the exact VST3 SDK source directory")

include(cmake/WebVstToolchain.cmake)
include(cmake/FetchVst3Sdk.cmake)

add_library(webvst_adapter STATIC
  src/adapter/adapter.cpp
  src/adapter/vst3_instance.cpp
  src/adapter/process_events.cpp
  src/adapter/memory_stream.cpp
)
target_compile_features(webvst_adapter PUBLIC cxx_std_17)
target_include_directories(webvst_adapter
  PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  PRIVATE ${WEBVST_VST3_SOURCE_DIR}
)
if(EMSCRIPTEN)
  # The VST3 SDK has no Emscripten platform branch; its Linux ABI branch is
  # the portable non-COM interface layout used by this standalone WASM build.
  target_compile_definitions(webvst_adapter PRIVATE __linux__=1)
endif()
function(webvst_enable_sanitizers target visibility)
  if(NOT WEBVST_ENABLE_SANITIZERS)
    return()
  endif()
  if(MSVC)
    target_compile_options(${target} ${visibility} /fsanitize=address)
    target_link_options(${target} INTERFACE /INCREMENTAL:NO)
  elseif(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(${target} ${visibility} -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(${target} INTERFACE -fsanitize=address,undefined)
  endif()
endfunction()
webvst_enable_sanitizers(webvst_adapter PUBLIC)

if(WEBVST_BUILD_FIXTURES)
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "WEBVST_BUILD_FIXTURES requires the Emscripten toolchain")
  endif()
  find_program(WEBVST_PNPM_EXECUTABLE pnpm REQUIRED)
  # The package targets run the TypeScript prober/packer, which compiles itself
  # with the local TypeScript. Without the install the failure surfaces mid-build
  # as an unhelpful "'tsc' is not recognized".
  if(NOT IS_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/tools/node_modules")
    message(FATAL_ERROR
      "Run 'pnpm --dir tools install --frozen-lockfile' before configuring the fixture build")
  endif()
endif()

if(WEBVST_BUILD_TESTS OR WEBVST_BUILD_FIXTURES)
  add_subdirectory(fixtures)
  add_subdirectory(conformance/adelay)
endif()

if(WEBVST_BUILD_TESTS)
  enable_testing()
  add_executable(abi_header_test tests/native/abi_header_test.cpp)
  target_compile_features(abi_header_test PRIVATE cxx_std_17)
  target_link_libraries(abi_header_test PRIVATE webvst_adapter)
  add_executable(webvst_adapter_tests
    tests/native/adapter_lifecycle_test.cpp
    tests/native/adapter_process_test.cpp
    tests/native/adapter_state_test.cpp
  )
  target_compile_features(webvst_adapter_tests PRIVATE cxx_std_17)
  target_include_directories(webvst_adapter_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/native ${WEBVST_VST3_SOURCE_DIR})
  target_link_libraries(webvst_adapter_tests PRIVATE webvst_adapter)

  add_executable(actual_vst3_fixture_test tests/native/actual_vst3_fixture_test.cpp)
  target_compile_features(actual_vst3_fixture_test PRIVATE cxx_std_17)
  target_include_directories(actual_vst3_fixture_test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/native ${WEBVST_VST3_SOURCE_DIR})
  target_link_libraries(actual_vst3_fixture_test PRIVATE
    webvst_adapter actual_vst3_fixture_factory)
  add_test(NAME actual_vst3_fixture COMMAND actual_vst3_fixture_test)

  add_executable(actual_vst3_component_test tests/native/actual_vst3_component_test.cpp)
  target_compile_features(actual_vst3_component_test PRIVATE cxx_std_17)
  target_include_directories(actual_vst3_component_test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR} ${WEBVST_VST3_SOURCE_DIR})
  target_link_libraries(actual_vst3_component_test PRIVATE
    webvst_adapter actual_vst3_fixture_factory)
  add_test(NAME actual_vst3_component COMMAND actual_vst3_component_test)

  add_executable(upstream_adelay_test tests/native/upstream_adelay_test.cpp)
  target_compile_features(upstream_adelay_test PRIVATE cxx_std_17)
  target_sources(upstream_adelay_test PRIVATE $<TARGET_OBJECTS:upstream_adelay_factory>)
  target_link_libraries(upstream_adelay_test PRIVATE
    webvst_adapter upstream_adelay_vst3_support)
  add_test(NAME upstream_adelay COMMAND upstream_adelay_test)
  if(WEBVST_ENABLE_SANITIZERS AND MSVC)
    get_filename_component(_webvst_msvc_bin_dir "${CMAKE_CXX_COMPILER}" DIRECTORY)
    set(_webvst_asan_runtimes
      "${_webvst_msvc_bin_dir}/clang_rt.asan_dbg_dynamic-x86_64.dll"
      "${_webvst_msvc_bin_dir}/clang_rt.asan_dynamic-x86_64.dll")
    foreach(_webvst_sanitized_target abi_header_test webvst_adapter_tests actual_vst3_fixture_test actual_vst3_component_test upstream_adelay_test)
      foreach(_webvst_asan_runtime IN LISTS _webvst_asan_runtimes)
        if(EXISTS "${_webvst_asan_runtime}")
        add_custom_command(TARGET ${_webvst_sanitized_target} POST_BUILD
          COMMAND ${CMAKE_COMMAND} -E copy_if_different "${_webvst_asan_runtime}"
            "$<TARGET_FILE_DIR:${_webvst_sanitized_target}>"
        )
        endif()
      endforeach()
    endforeach()
  endif()
  set(_webvst_abi_header_ctest_template [=[
set(_webvst_abi_header_test_candidates
  "@CMAKE_CURRENT_BINARY_DIR@/abi_header_test@CMAKE_EXECUTABLE_SUFFIX@"
  "@CMAKE_CURRENT_BINARY_DIR@/Debug/abi_header_test@CMAKE_EXECUTABLE_SUFFIX@"
)
set(_webvst_abi_header_test_found FALSE)
foreach(_webvst_abi_header_test IN LISTS _webvst_abi_header_test_candidates)
  if(EXISTS "${_webvst_abi_header_test}")
    add_test(abi_header "${_webvst_abi_header_test}")
    set(_webvst_abi_header_test_found TRUE)
    break()
  endif()
endforeach()
if(NOT _webvst_abi_header_test_found)
  add_test(abi_header "@CMAKE_COMMAND@" -E false)
endif()

]=]
  )
  string(CONFIGURE "${_webvst_abi_header_ctest_template}"
    _webvst_abi_header_ctest_content @ONLY)
  file(GENERATE
    OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/abi_header_test_ctest.cmake"
    CONTENT "${_webvst_abi_header_ctest_content}"
  )
  set_property(DIRECTORY APPEND PROPERTY TEST_INCLUDE_FILES
    "${CMAKE_CURRENT_BINARY_DIR}/abi_header_test_ctest.cmake")
  set(_webvst_adapter_ctest_template [=[
set(_webvst_adapter_test_candidates
  "@CMAKE_CURRENT_BINARY_DIR@/webvst_adapter_tests@CMAKE_EXECUTABLE_SUFFIX@"
  "@CMAKE_CURRENT_BINARY_DIR@/Debug/webvst_adapter_tests@CMAKE_EXECUTABLE_SUFFIX@"
)
foreach(_webvst_adapter_test IN LISTS _webvst_adapter_test_candidates)
  if(EXISTS "${_webvst_adapter_test}")
    add_test(webvst_adapter "${_webvst_adapter_test}")
    break()
  endif()
endforeach()
]=]
  )
  string(CONFIGURE "${_webvst_adapter_ctest_template}"
    _webvst_adapter_ctest_content @ONLY)
  file(GENERATE
    OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/webvst_adapter_ctest.cmake"
    CONTENT "${_webvst_adapter_ctest_content}"
  )
  set_property(DIRECTORY APPEND PROPERTY TEST_INCLUDE_FILES
    "${CMAKE_CURRENT_BINARY_DIR}/webvst_adapter_ctest.cmake")
endif()

if(WEBVST_BUILD_FIXTURES)
  add_executable(webvst_fixture fixtures/bundle/wasm_entry.cpp)
  target_link_libraries(webvst_fixture PRIVATE
    webvst_adapter
    actual_vst3_fixture_factory
  )
  webvst_configure_target(webvst_fixture)

  set(WEBVST_FIXTURE_STAGING_DIR "${CMAKE_CURRENT_BINARY_DIR}/packages/fixture-staging")
  set(WEBVST_FIXTURE_PACKAGE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/build/packages")
  set(WEBVST_FIXTURE_PACKAGE "${WEBVST_FIXTURE_PACKAGE_DIR}/webvst-fixtures.webvst")
  set_target_properties(webvst_fixture PROPERTIES
    SUFFIX ".wasm"
    RUNTIME_OUTPUT_DIRECTORY "${WEBVST_FIXTURE_STAGING_DIR}"
    OUTPUT_NAME "plugin"
  )

  add_custom_target(webvst_fixture_package ALL
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVST_FIXTURE_STAGING_DIR}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVST_FIXTURE_PACKAGE_DIR}"
    COMMAND ${WEBVST_PNPM_EXECUTABLE} --dir "${CMAKE_CURRENT_SOURCE_DIR}/tools" run webvst -- manifest
      "$<TARGET_FILE:webvst_fixture>" org.webvst.fixtures 1.0.0 plugin.wasm
      "${WEBVST_FIXTURE_STAGING_DIR}/plugin.json"
    COMMAND ${WEBVST_PNPM_EXECUTABLE} --dir "${CMAKE_CURRENT_SOURCE_DIR}/tools" run webvst -- pack
      "${WEBVST_FIXTURE_STAGING_DIR}" "${WEBVST_FIXTURE_PACKAGE}"
    BYPRODUCTS "${WEBVST_FIXTURE_PACKAGE}"
    DEPENDS webvst_fixture
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/package.json"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/src/archive.ts"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/src/cli.ts"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/src/manifest.ts"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/src/probe.ts"
    VERBATIM
  )
endif()
