include_guard(GLOBAL)

include("${CMAKE_CURRENT_LIST_DIR}/WebVstExports.cmake")

function(webvst_configure_target target)
  if(NOT TARGET "${target}")
    message(FATAL_ERROR "webvst_configure_target requires an existing target: ${target}")
  endif()

  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "webvst_configure_target requires the Emscripten toolchain")
  endif()

  if(NOT DEFINED WEBVST_VST3_SOURCE_DIR OR
     NOT IS_DIRECTORY "${WEBVST_VST3_SOURCE_DIR}" OR
     NOT EXISTS "${WEBVST_VST3_SOURCE_DIR}/pluginterfaces/vst/ivstaudioprocessor.h")
    message(FATAL_ERROR
      "WEBVST_VST3_SOURCE_DIR must name the resolved exact VST3 SDK source directory")
  endif()

  get_target_property(_webvst_wasmfs ${target} WEBVST_WASMFS)
  if(_webvst_wasmfs)
    set(_webvst_filesystem -sWASMFS=1)
  else()
    set(_webvst_filesystem -sFILESYSTEM=0)
  endif()

  target_link_options(${target} PRIVATE
    -sSTANDALONE_WASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sMALLOC=emmalloc
    -sERROR_ON_UNDEFINED_SYMBOLS=1
    -Wl,--no-entry
    "-sEXPORTED_FUNCTIONS=${WEBVST_EXPORTS}"
    ${_webvst_filesystem}
  )
endfunction()
