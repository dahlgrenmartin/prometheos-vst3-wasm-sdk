include_guard(GLOBAL)

include("${CMAKE_CURRENT_LIST_DIR}/WebVstExports.cmake")

function(prometheos_configure_webvst target)
  if(NOT TARGET "${target}")
    message(FATAL_ERROR "prometheos_configure_webvst requires an existing target: ${target}")
  endif()

  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "prometheos_configure_webvst requires the Emscripten toolchain")
  endif()

  if(NOT DEFINED PROMETHEOS_VST3_SDK_DIR OR
     NOT IS_DIRECTORY "${PROMETHEOS_VST3_SDK_DIR}" OR
     NOT EXISTS "${PROMETHEOS_VST3_SDK_DIR}/pluginterfaces/vst/ivstaudioprocessor.h")
    message(FATAL_ERROR
      "PROMETHEOS_VST3_SDK_DIR must name the exact VST3 SDK source directory")
  endif()

  get_target_property(_prometheos_webvst_wasmfs ${target} PROMETHEOS_WEBVST_WASMFS)
  if(_prometheos_webvst_wasmfs)
    set(_prometheos_webvst_filesystem -sWASMFS=1)
  else()
    set(_prometheos_webvst_filesystem -sFILESYSTEM=0)
  endif()

  target_link_options(${target} PRIVATE
    -sSTANDALONE_WASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sMALLOC=emmalloc
    -sERROR_ON_UNDEFINED_SYMBOLS=1
    -Wl,--no-entry
    "-sEXPORTED_FUNCTIONS=${PROMETHEOS_WEBVST_EXPORTS}"
    ${_prometheos_webvst_filesystem}
  )
endfunction()
