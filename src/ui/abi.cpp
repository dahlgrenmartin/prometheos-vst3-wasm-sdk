#include <webvst/webvst_ui.h>
#include <webvst/ui.h>
#include <array>
#include <cmath>
#include <cstdlib>
#include <limits>
#ifdef __wasm__
#define WVUI_EXPORT __attribute__((used,visibility("default")))
#define WVUI_IMPORT(name) __attribute__((import_module("webvst_ui"),import_name(name)))
#else
#define WVUI_EXPORT
#define WVUI_IMPORT(name)
#endif
extern "C" {
int32_t ui_submit(uint32_t,const char*,uint32_t) WVUI_IMPORT("submit");
int32_t ui_parameter(uint32_t,uint32_t,double) WVUI_IMPORT("parameter");
void ui_invalidate() WVUI_IMPORT("invalidate");
// Standalone libc's failure path must trap locally, never acquire WASI authority.
#ifdef __wasm__
void __wasi_proc_exit(uint32_t) { __builtin_trap(); }
__wasi_errno_t __wasi_fd_write(__wasi_fd_t,const __wasi_ciovec_t*,size_t,__wasi_size_t*) {return 8;}
#endif
}
namespace {
// Bounded, strict JSON reader. No substring field matching: malformed events are discarded.
struct Json {
  enum Type {Null,Number,String,Boolean,Object,Array} type=Null;
  double number=0; bool boolean=false; std::string string;
  std::map<std::string,Json> object; std::vector<Json> array;
  const Json* get(const char* key)const{auto i=object.find(key);return i==object.end()?nullptr:&i->second;}
};
struct Reader {
 const char* p; const char* end; size_t nodes=0;
 void space(){while(p<end&&(*p==' '||*p=='\n'||*p=='\r'||*p=='\t'))++p;}
 bool take(char c){space();if(p==end||*p!=c)return false;++p;return true;}
 bool str(std::string& out){if(!take('"'))return false;while(p<end){unsigned char c=*p++;if(c=='"')return true;if(c<32)return false;if(c!='\\'){out+=char(c);continue;}if(p==end)return false;c=*p++;if(c=='"'||c=='\\'||c=='/')out+=char(c);else if(c=='n')out+='\n';else if(c=='r')out+='\r';else if(c=='t')out+='\t';else if(c=='b')out+='\b';else if(c=='f')out+='\f';else if(c=='u'){unsigned code=0;for(int i=0;i<4;i++){if(p==end)return false;char h=*p++;unsigned n=h>='0'&&h<='9'?h-'0':h>='a'&&h<='f'?h-'a'+10:h>='A'&&h<='F'?h-'A'+10:16;if(n==16)return false;code=code*16+n;}if(code>=0xd800&&code<=0xdfff)return false;if(code<128)out+=char(code);else if(code<2048){out+=char(0xc0|(code>>6));out+=char(0x80|(code&63));}else{out+=char(0xe0|(code>>12));out+=char(0x80|((code>>6)&63));out+=char(0x80|(code&63));}}else return false;}return false;}
 bool read(Json& out,unsigned depth=0){space();if(p==end||depth>16||++nodes>131072)return false;if(*p=='"'){out.type=Json::String;return str(out.string);}if(*p=='{'){++p;out.type=Json::Object;if(take('}'))return true;do{std::string key;if(!str(key)||!take(':')||out.object.count(key))return false;Json child;if(!read(child,depth+1))return false;out.object.emplace(std::move(key),std::move(child));if(take('}'))return true;}while(take(','));return false;}if(*p=='['){++p;out.type=Json::Array;if(take(']'))return true;do{Json child;if(!read(child,depth+1))return false;out.array.push_back(std::move(child));if(take(']'))return true;}while(take(','));return false;}
 for(auto literal:{"true","false","null"}){auto q=p;const char* l=literal;while(q<end&&*l&&*q==*l){q++;l++;}if(!*l){p=q;out.type=literal[0]=='n'?Json::Null:Json::Boolean;out.boolean=literal[0]=='t';return true;}}
 const char* start=p;if(*p=='-')++p;if(p==end)return false;if(*p=='0')++p;else{if(*p<'1'||*p>'9')return false;while(p<end&&*p>='0'&&*p<='9')++p;}if(p<end&&*p=='.'){++p;const char* s=p;while(p<end&&*p>='0'&&*p<='9')++p;if(p==s)return false;}if(p<end&&(*p=='e'||*p=='E')){++p;if(p<end&&(*p=='+'||*p=='-'))++p;const char* s=p;while(p<end&&*p>='0'&&*p<='9')++p;if(s==p)return false;}std::string n(start,p);out.number=std::strtod(n.c_str(),nullptr);out.type=Json::Number;return std::isfinite(out.number);
 }
};
bool numeric(const Json& j,const char* name,double& value,bool required=false){auto* v=j.get(name);if(!v)return !required;if(v->type!=Json::Number)return false;value=v->number;return true;}
std::string string(const Json& j,const char* key){auto* v=j.get(key);return v&&v->type==Json::String?v->string:"";}
bool boolean(const Json& j,const char* key){auto* v=j.get(key);return v&&v->type==Json::Boolean&&v->boolean;}
struct Editor {
 webvst::Parameters parameters{[](int op,uint32_t id,double v){return ui_parameter(op,id,v);}};
 std::unique_ptr<webvst::Runtime> runtime;
 Editor(){parameters.programs().setRequest([](int c,int p){auto json="{\"type\":\"program\",\"category\":"+std::to_string(c)+",\"program\":"+std::to_string(p)+"}";return ui_submit(3,json.data(),uint32_t(json.size()));});auto root=webvst::createEditor(parameters);if(root)runtime=std::make_unique<webvst::Runtime>(std::move(root),parameters,[](int kind,const std::string& batch){if(batch.size()>4194304)return -1;return ui_submit(kind,batch.data(),uint32_t(batch.size()));},[]{ui_invalidate();});}
};
struct Slot{uint32_t generation=0;std::unique_ptr<Editor> editor;};
std::array<Slot,32> slots;
std::map<uint32_t,uint32_t> allocations;
Editor* editor(uint32_t h){uint32_t index=h&65535;if(index==0||index>slots.size())return nullptr;auto& s=slots[index-1];return s.generation==(h>>16)?s.editor.get():nullptr;}
void receive(Editor& e,const Json& j){
 if(j.type!=Json::Object)return;auto type=string(j,"type");
 if(type=="parameters"){auto* list=j.get("parameters");if(!list||list->type!=Json::Array)return;for(auto& item:list->array){auto id=string(item,"id");if(id.empty()||id.size()>10)continue;uint64_t n=0;bool valid=true;for(char c:id){if(c<'0'||c>'9'){valid=false;break;}n=n*10+uint32_t(c-'0');}if(!valid||n>UINT32_MAX)continue;webvst::ParameterMetadata m;m.id=uint32_t(n);m.name=string(item,"name");double steps=0;if(!numeric(item,"defaultValue",m.defaultValue)||!numeric(item,"stepCount",steps)||m.defaultValue<0||m.defaultValue>1||steps<0||steps>UINT32_MAX||steps!=std::floor(steps))continue;m.stepCount=uint32_t(steps);m.readOnly=boolean(item,"readOnly");if(auto* choices=item.get("choices"))if(choices->type==Json::Array)for(auto& c:choices->array)if(c.type==Json::String)m.choices.push_back(c.string);e.parameters.define(std::move(m));}return;}
 if(type=="programs"){auto* list=j.get("categories");if(!list||list->type!=Json::Array)return;std::vector<webvst::ProgramCategory> categories;for(auto& item:list->array){webvst::ProgramCategory c;c.name=string(item,"name");if(auto* programs=item.get("programs"))if(programs->type==Json::Array)for(auto& p:programs->array)if(p.type==Json::String)c.programs.push_back(p.string);categories.push_back(std::move(c));}e.parameters.programs().setCategories(std::move(categories));return;}
 if(type=="program"){double c=-1,p=-1;if(!numeric(j,"category",c,true)||!numeric(j,"program",p,true)||c!=std::floor(c)||p!=std::floor(p)||c<0||p<0||c>65535||p>65535)return;e.parameters.programs().publish(int(c),int(p));return;}
 webvst::Event event;
 if(type=="pointerdown")event.type=webvst::EventType::PointerDown;else if(type=="pointermove")event.type=webvst::EventType::PointerMove;else if(type=="pointerup")event.type=webvst::EventType::PointerUp;else if(type=="pointercancel")event.type=webvst::EventType::PointerCancel;else if(type=="keydown")event.type=webvst::EventType::KeyDown;else if(type=="keyup")event.type=webvst::EventType::KeyUp;else if(type=="wheel")event.type=webvst::EventType::Wheel;else if(type=="focus")event.type=webvst::EventType::Focus;else if(type=="blur")event.type=webvst::EventType::Blur;else if(type=="change")event.type=webvst::EventType::Change;else return;
 bool position=type=="pointerdown"||type=="pointermove"||type=="pointerup"||type=="wheel";double pointer=0;
 if(!numeric(j,"x",event.x,position)||!numeric(j,"y",event.y,position)||!numeric(j,"pointerId",pointer)||pointer<0||pointer>UINT32_MAX||pointer!=std::floor(pointer)||!numeric(j,"value",event.value,type=="change")||!numeric(j,"deltaX",event.deltaX)||!numeric(j,"deltaY",event.deltaY))return;
 double button=0;if(!numeric(j,"button",button)||button<-1||button>16)return;event.button=int(button);event.pointerId=uint32_t(pointer);event.key=string(j,"key");event.targetId=string(j,"targetId");event.shiftKey=boolean(j,"shiftKey");event.ctrlKey=boolean(j,"ctrlKey");event.altKey=boolean(j,"altKey");event.metaKey=boolean(j,"metaKey");e.runtime->event(std::move(event));
}
}
extern "C" {
WVUI_EXPORT uint32_t wvui_version(){return WVUI_ABI_VERSION;}
WVUI_EXPORT uint32_t wvui_alloc(uint32_t bytes){if(!bytes||bytes>WVUI_MAX_EVENT_BYTES||allocations.size()>=64)return 0;auto* p=std::malloc(bytes);if(!p)return 0;auto ptr=uint32_t(reinterpret_cast<uintptr_t>(p));allocations[ptr]=bytes;return ptr;}
WVUI_EXPORT void wvui_free(uint32_t ptr,uint32_t bytes){auto i=allocations.find(ptr);if(i==allocations.end()||i->second!=bytes)return;std::free(reinterpret_cast<void*>(uintptr_t(ptr)));allocations.erase(i);}
WVUI_EXPORT uint32_t wvui_create(){for(uint32_t i=0;i<slots.size();i++){auto& s=slots[i];if(!s.editor){s.generation=(s.generation+1)&65535;if(!s.generation)s.generation=1;s.editor=std::make_unique<Editor>();if(!s.editor->runtime){s.editor.reset();return 0;}ui_invalidate();return (s.generation<<16)|(i+1);}}return 0;}
WVUI_EXPORT void wvui_destroy(uint32_t h){if(editor(h))slots[(h&65535)-1].editor.reset();}
WVUI_EXPORT void wvui_resize(uint32_t h,double w,double height,double scale){if(auto* e=editor(h))if(w>0&&w<=32768&&height>0&&height<=32768&&scale>0&&scale<=16)e->runtime->resize(w,height,scale);}
WVUI_EXPORT void wvui_event(uint32_t h,uint32_t ptr,uint32_t bytes){auto* e=editor(h);auto i=allocations.find(ptr);if(!e||i==allocations.end()||!bytes||bytes>i->second)return;auto* p=reinterpret_cast<const char*>(uintptr_t(ptr));Reader reader{p,p+bytes};Json j;if(!reader.read(j))return;reader.space();if(reader.p!=reader.end)return;receive(*e,j);}
WVUI_EXPORT void wvui_parameter(uint32_t h,uint32_t id,double value){if(auto* e=editor(h))e->parameters.publish(id,value);}
WVUI_EXPORT void wvui_frame(uint32_t h,double time){if(auto* e=editor(h))if(std::isfinite(time))e->runtime->frame(time);}
}
