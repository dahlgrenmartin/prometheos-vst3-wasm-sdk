include_guard(GLOBAL)

set(WEBVST_EXPORTS
  "['__initialize','_malloc','_free','_webvst_abi_version','_webvst_class_count','_webvst_class_uid_size','_webvst_class_uid_write','_webvst_class_name_size','_webvst_class_name_write','_webvst_class_vendor_size','_webvst_class_vendor_write','_webvst_class_kind','_webvst_class_param_count','_webvst_class_param_id','_webvst_class_param_flags','_webvst_class_param_step_count','_webvst_class_param_default','_webvst_class_param_title_size','_webvst_class_param_title_write','_webvst_class_param_value_text_size','_webvst_class_param_value_text_write','_webvst_create','_webvst_destroy','_webvst_reset','_webvst_process','_webvst_note_on','_webvst_note_off','_webvst_param_get','_webvst_param_set','_webvst_state_size','_webvst_state_write','_webvst_state_load']"
)

# Optional extension webvst-ext-message-1 (see docs/abi-v1.md): a plugin-defined
# request/reply channel for editors. Modules that implement it export these too.
set(WEBVST_EXT_MESSAGE_EXPORTS "'_webvst_ext_message','_webvst_ext_reply_write'")
string(REPLACE "]" ",${WEBVST_EXT_MESSAGE_EXPORTS}]" WEBVST_EXPORTS_WITH_MESSAGES "${WEBVST_EXPORTS}")
