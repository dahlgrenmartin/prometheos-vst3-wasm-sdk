#include <webvst/ui.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
namespace webvst {
namespace {
std::string number(double v) { char b[48]; std::snprintf(b,sizeof(b),"%.12g",std::isfinite(v)?v:0); return b; }
std::string quote(const std::string& s) {
  std::string out="\""; for(unsigned char c:s) { if(c=='"'||c=='\\') {out+='\\';out+=char(c);} else if(c=='\n')out+="\\n";else if(c=='\r')out+="\\r";else if(c=='\t')out+="\\t";else if(c<32) {char b[8];std::snprintf(b,sizeof(b),"\\u%04x",c);out+=b;} else out+=char(c); } return out+'"';
}
std::string boundsJson(Rect r) {return "\"x\":"+number(r.x)+",\"y\":"+number(r.y)+",\"width\":"+number(r.width)+",\"height\":"+number(r.height);}
std::string semantics(const Component& c,const std::string& role) { return "\"id\":"+quote(c.id())+",\"role\":"+quote(role)+",\"label\":"+quote(c.label())+",\"bounds\":{"+boundsJson(c.globalBounds())+"},\"disabled\":"+(c.enabled()?"false":"true"); }
bool descendant(Component* c,Component* ancestor) {for(;c;c=c->parent()) if(c==ancestor)return true;return false;}
Component* find(Component& c,const std::string& id) { if(!c.visible()||!c.enabled())return nullptr;if(c.id()==id)return &c;for(auto* ch:c.children())if(auto* f=find(*ch,id))return f;return nullptr; }
Component* hit(Component& c,double x,double y) {if(!c.visible()||!c.enabled()||!c.globalBounds().contains(x,y))return nullptr;for(auto i=c.children().rbegin();i!=c.children().rend();++i)if(auto* f=hit(**i,x,y))return f;return &c;}
void focusables(Component& c,std::vector<Component*>& out) {if(!c.visible()||!c.enabled())return;if(c.focusable())out.push_back(&c);for(auto* ch:c.children())focusables(*ch,out);}
}
bool Rect::contains(double px,double py) const {return px>=x&&py>=y&&px<x+width&&py<y+height;}
void Graphics::add(std::string command) {if(commands_.size()>=65536)return;if(opacity_<1&&command.size()>1&&command.back()=='}'){command.pop_back();command+=",\"opacity\":"+number(opacity_)+"}";}commands_.push_back(std::move(command));}
void Graphics::save(){opacities_.push_back(opacity_);add("{\"op\":\"save\"}");}
void Graphics::restore(){if(!opacities_.empty()){opacity_=opacities_.back();opacities_.pop_back();}add("{\"op\":\"restore\"}");}
void Graphics::setOpacity(double o){opacity_=std::isfinite(o)?std::clamp(o,0.,1.):1;}
void Graphics::scale(double s){transform(s,0,0,s,0,0);}
void Graphics::strokeRect(Rect r,const std::string& c,double w,double radius){add("{\"op\":\"rect\","+boundsJson(r)+",\"color\":"+quote(c)+",\"radius\":"+number(radius)+",\"stroke\":true,\"lineWidth\":"+number(w)+"}");}
void Graphics::strokePath(const std::vector<std::pair<double,double>>& points,const std::string& c,double w,bool closed){std::string p;for(auto v:points){if(!p.empty())p+=',';p+='['+number(v.first)+','+number(v.second)+']';}add("{\"op\":\"path\",\"points\":["+p+"],\"color\":"+quote(c)+",\"closed\":"+(closed?"true":"false")+",\"stroke\":true,\"lineWidth\":"+number(w)+"}");}
void Graphics::clip(Rect r){add("{\"op\":\"clip\","+boundsJson(r)+"}");}
void Graphics::translate(double x,double y){transform(1,0,0,1,x,y);}
void Graphics::transform(double a,double b,double c,double d,double e,double f){add("{\"op\":\"transform\",\"matrix\":["+number(a)+","+number(b)+","+number(c)+","+number(d)+","+number(e)+","+number(f)+"]}");}
void Graphics::rect(Rect r,const std::string& c,double radius){add("{\"op\":\"rect\","+boundsJson(r)+",\"color\":"+quote(c)+",\"radius\":"+number(radius)+"}");}
void Graphics::line(double x1,double y1,double x2,double y2,const std::string& c,double width){add("{\"op\":\"line\",\"x1\":"+number(x1)+",\"y1\":"+number(y1)+",\"x2\":"+number(x2)+",\"y2\":"+number(y2)+",\"color\":"+quote(c)+",\"width\":"+number(width)+"}");}
void Graphics::text(const std::string& text,double x,double y,double size,const std::string& c,const std::string& font,Align align){add("{\"op\":\"text\",\"text\":"+quote(text)+",\"x\":"+number(x)+",\"y\":"+number(y)+",\"size\":"+number(size)+",\"color\":"+quote(c)+",\"font\":"+quote(font)+(align==Align::Center?",\"align\":\"center\"":align==Align::Right?",\"align\":\"right\"":"")+"}");}
void Graphics::image(const std::string& asset,Rect r){add("{\"op\":\"image\",\"asset\":"+quote(asset)+","+boundsJson(r)+"}");}
void Graphics::path(const std::vector<std::pair<double,double>>& points,const std::string& c,bool closed){std::string p;for(auto v:points){if(!p.empty())p+=',';p+='['+number(v.first)+','+number(v.second)+']';}add("{\"op\":\"path\",\"points\":["+p+"],\"color\":"+quote(c)+",\"closed\":"+(closed?"true":"false")+"}");}
std::string Graphics::json()const{std::string s="{\"version\":1,\"commands\":[";bool first=true;for(auto& c:commands_){if(!first)s+=',';s+=c;first=false;}return s+"]}";}
Component::Component(std::string id,std::string label):id_(std::move(id)),label_(std::move(label)){}
Component::~Component(){if(runtime_)runtime_->detached(this);if(parent_)parent_->removeChild(*this);for(auto* c:children_){c->parent_=nullptr;c->connect(nullptr);}}
void Component::connect(Runtime* r){runtime_=r;for(auto* c:children_)c->connect(r);}
void Component::setLabel(std::string label){label_=std::move(label);repaint();}
void Component::setBounds(Rect r){if(!std::isfinite(r.x)||!std::isfinite(r.y)||!std::isfinite(r.width)||!std::isfinite(r.height)||r.width<0||r.height<0)return;bounds_=r;resized();repaint();}
Rect Component::globalBounds()const{Rect r=bounds_;for(auto* p=parent_;p;p=p->parent_){r={p->bounds_.x+r.x*p->scale_,p->bounds_.y+r.y*p->scale_,r.width*p->scale_,r.height*p->scale_};}return r;}
void Component::setContentScale(double s){if(!std::isfinite(s)||s<=0||s>64||s==scale_)return;scale_=s;repaint();}
double Component::globalScale()const{double s=1;for(auto* p=parent_;p;p=p->parent_)s*=p->scale_;return s;}
void Component::toLocal(double gx,double gy,double& x,double& y)const{auto g=globalBounds();double s=globalScale();x=(gx-g.x)/s;y=(gy-g.y)/s;}
void Component::addAndMakeVisible(Component& c){if(&c==this||descendant(this,&c))return;if(c.parent_)c.parent_->removeChild(c);children_.push_back(&c);c.parent_=this;c.connect(runtime_);c.visible_=true;repaint();}
void Component::removeChild(Component& c){auto i=std::find(children_.begin(),children_.end(),&c);if(i==children_.end())return;if(runtime_)runtime_->detached(&c);children_.erase(i);c.parent_=nullptr;c.connect(nullptr);repaint();}
void Component::setVisible(bool visible){if(visible_==visible)return;if(!visible&&runtime_)runtime_->detached(this);visible_=visible;repaint();}
void Component::setEnabled(bool enabled){if(enabled_==enabled)return;if(!enabled&&runtime_)runtime_->detached(this);enabled_=enabled;repaint();}
void Component::repaint(){if(runtime_)runtime_->invalidate();}
bool Component::hasFocus()const{return runtime_&&runtime_->focused()==this;}
void Component::grabFocus(){if(runtime_)runtime_->focus(this);}
void Component::capturePointer(uint32_t id){if(runtime_)runtime_->capture(this,id);}
void Component::releasePointer(uint32_t id){if(runtime_)runtime_->release(this,id);}
void Parameters::define(ParameterMetadata m){metadata_[m.id]=std::move(m);}
const ParameterMetadata* Parameters::metadata(uint32_t id)const{auto i=metadata_.find(id);return i==metadata_.end()?nullptr:&i->second;}
double Parameters::get(uint32_t id)const{auto i=values_.find(id);if(i!=values_.end())return i->second;auto* m=metadata(id);return m?m->defaultValue:0;}
void Parameters::publish(uint32_t id,double value){if(!std::isfinite(value))return;value=std::clamp(value,0.,1.);values_[id]=value;auto attached=attachments_;for(auto* a:attached)if(a->id_==id&&a->control_)a->control_->setCanonicalValue(value);for(auto& f:listeners_)f(id,value);}
void Parameters::cancelAll(){for(auto* a:attachments_)a->end();}
ParameterAttachment::ParameterAttachment(Parameters& p,uint32_t id,ParameterControl& c):parameters_(p),id_(id),control_(&c){if(c.attachment_){c.attachment_->end();c.attachment_->control_=nullptr;}c.attachment_=this;p.attachments_.push_back(this);c.setCanonicalValue(p.get(id));}
ParameterAttachment::~ParameterAttachment(){end();if(control_)control_->attachment_=nullptr;auto& a=parameters_.attachments_;a.erase(std::remove(a.begin(),a.end(),this),a.end());}
void ParameterAttachment::begin(){auto* m=metadata();if(!active_&&(!m||!m->readOnly)&&parameters_.request_(0,id_,0)>=0)active_=true;}
void ParameterAttachment::set(double value){auto* m=metadata();if(!active_||!std::isfinite(value)||(m&&m->readOnly))return;value=std::clamp(value,0.,1.);if(m&&m->stepCount)value=std::round(value*m->stepCount)/m->stepCount;parameters_.request_(1,id_,value);}
void ParameterAttachment::end(){if(!active_)return;active_=false;parameters_.request_(2,id_,0);}
ParameterControl::~ParameterControl(){if(attachment_){attachment_->end();attachment_->control_=nullptr;}}
void ParameterControl::setCanonicalValue(double value){value_=value;repaint();}
double ParameterControl::requestedValue(const Event& e)const{auto b=globalBounds();return b.width>0?(e.x-b.x)/b.width:0;}
void ParameterControl::onEvent(Event& e){
  if(e.phase!=EventPhase::Target||!enabled()||!attachment_)return;
  if(e.type==EventType::PointerDown&&!dragging_){dragging_=true;pointer_=e.pointerId;grabFocus();capturePointer(pointer_);attachment_->begin();attachment_->set(requestedValue(e));}
  else if(e.type==EventType::PointerMove&&dragging_&&e.pointerId==pointer_)attachment_->set(requestedValue(e));
  else if((e.type==EventType::PointerUp||e.type==EventType::PointerCancel)&&dragging_&&e.pointerId==pointer_){dragging_=false;releasePointer(pointer_);attachment_->end();}
  else if(e.type==EventType::Blur){dragging_=false;releasePointer(pointer_);attachment_->end();}
  else if(e.type==EventType::Change){attachment_->begin();attachment_->set(e.value);attachment_->end();}
  else if(e.type==EventType::KeyDown){auto* m=attachment_->metadata();double step=m&&m->stepCount?1./m->stepCount:.01;double v=value_;if(e.key=="ArrowRight"||e.key=="ArrowUp")v+=step;else if(e.key=="ArrowLeft"||e.key=="ArrowDown")v-=step;else if(e.key=="Home")v=0;else if(e.key=="End")v=1;else if(e.key==" "||e.key=="Enter")v=value_>=.5?0:1;else return;attachment_->begin();attachment_->set(v);attachment_->end();e.stopPropagation();}
}
std::string ParameterControl::semantic()const{auto s=semantics(*this,role())+",\"value\":"+number(value_)+",\"min\":0,\"max\":1";if(attachment_)s+=",\"parameter\":"+quote(std::to_string(attachment_->id()));if(std::string(role())=="switch")s+=std::string(",\"checked\":")+(value_>=.5?"true":"false");return '{'+s+'}';}
Slider::Slider(std::string id,std::string label):ParameterControl(std::move(id),std::move(label)){setFocusable(true);}
void Slider::paint(Graphics& g){auto b=bounds();g.rect({0,0,b.width,b.height},"#242936",4);g.rect({0,b.height-7,b.width*value_,7},"#5bc7e8",3);g.text(label(),8,18,12,"#e8edf5");if(hasFocus())g.line(0,1,b.width,1,"#ffffff",2);}
void Knob::paint(Graphics& g){Slider::paint(g);auto b=bounds();double a=(value_*1.5-1.25)*3.141592653589793;g.line(b.width*.5,b.height*.55,b.width*.5+std::cos(a)*b.height*.25,b.height*.55+std::sin(a)*b.height*.25,"#ffffff",2);}
double Toggle::requestedValue(const Event&)const{return value_>=.5?0:1;}
void Toggle::paint(Graphics& g){auto b=bounds();g.rect({0,0,b.width,b.height},value_>=.5?"#237c8e":"#303744",4);g.text(label(),8,18,12,"#ffffff");}
void ComboBox::setChoices(std::vector<std::string> c){choices_=std::move(c);repaint();}
double ComboBox::requestedValue(const Event&)const{size_t n=choices_.size();if(n<2&&attachment_&&attachment_->metadata())n=attachment_->metadata()->choices.size();if(n<2)return value_>=.5?0:1;return double((size_t(std::round(value_*(n-1)))+1)%n)/(n-1);}
void ComboBox::paint(Graphics& g){Slider::paint(g);if(!choices_.empty())g.text(choices_[size_t(std::round(value_*(choices_.size()-1)))],8,bounds().height-12,11,"#b5c5d8");}
void Label::paint(Graphics& g){g.text(label(),0,18,14,"#e8edf5");}
std::string Label::semantic()const{return '{'+semantics(*this,"text")+'}';}
Button::Button(std::string id,std::string label):Component(std::move(id),std::move(label)){setFocusable(true);}
void Button::paint(Graphics& g){auto b=bounds();g.rect({0,0,b.width,b.height},pressed_?"#38768b":"#303744",4);g.text(label(),8,19,12,"#ffffff");}
void Button::onEvent(Event& e){if(e.phase!=EventPhase::Target||!enabled())return;if(e.type==EventType::PointerDown){pressed_=true;pointer_=e.pointerId;capturePointer(pointer_);grabFocus();repaint();}else if(e.type==EventType::PointerUp&&e.pointerId==pointer_){bool click=pressed_&&globalBounds().contains(e.x,e.y);pressed_=false;releasePointer(pointer_);repaint();if(click&&onClick)onClick();}else if(e.type==EventType::PointerCancel||e.type==EventType::Blur){pressed_=false;releasePointer(pointer_);repaint();}else if(e.type==EventType::KeyDown&&(e.key==" "||e.key=="Enter")){if(onClick)onClick();e.stopPropagation();}}
std::string Button::semantic()const{return '{'+semantics(*this,"button")+'}';}
Runtime::Runtime(std::unique_ptr<Component> root,Parameters& p,Submit s,std::function<void()> invalidation):root_(std::move(root)),parameters_(p),submit_(std::move(s)),invalidate_(std::move(invalidation)){root_->connect(this);}
Runtime::~Runtime(){parameters_.cancelAll();root_->connect(nullptr);}
void Runtime::invalidate(){if(!dirty_){dirty_=true;invalidate_();}}
void Runtime::resize(double w,double h,double scale){if(!std::isfinite(scale)||scale<=0)return;root_->setBounds({0,0,w,h});}
Component* Runtime::hitTest(double x,double y)const{return hit(*root_,x,y);}
void Runtime::dispatch(Component* target,Event& e){if(!target)return;std::vector<Component*> route;for(auto* c=target;c;c=c->parent())route.push_back(c);e.phase=EventPhase::Capture;for(auto i=route.rbegin();i!=route.rend()&&!e.stopped;++i)if(*i!=target)(*i)->onEvent(e);if(!e.stopped){e.phase=EventPhase::Target;target->onEvent(e);}e.phase=EventPhase::Bubble;for(size_t i=1;i<route.size()&&!e.stopped;i++)route[i]->onEvent(e);}
void Runtime::focus(Component* c){if(c==focused_||(c&&!c->focusable()))return;auto* old=focused_;focused_=c;if(old){Event e;e.type=EventType::Blur;dispatch(old,e);old->repaint();}if(c){Event e;e.type=EventType::Focus;dispatch(c,e);c->repaint();}}
void Runtime::capture(Component* c,uint32_t id){auto i=captures_.find(id);if(i!=captures_.end()&&i->second!=c){Event e;e.type=EventType::PointerCancel;e.pointerId=id;dispatch(i->second,e);}captures_[id]=c;}
void Runtime::release(Component* c,uint32_t id){auto i=captures_.find(id);if(i!=captures_.end()&&i->second==c)captures_.erase(i);}
void Runtime::detached(Component* c){if(descendant(focused_,c))focus(nullptr);auto captures=captures_;for(auto& entry:captures)if(descendant(entry.second,c)){Event e;e.type=EventType::PointerCancel;e.pointerId=entry.first;dispatch(entry.second,e);captures_.erase(entry.first);}invalidate();}
void Runtime::event(Event e){
 if(e.type==EventType::Blur){focus(nullptr);auto captures=captures_;for(auto& entry:captures){Event cancel;cancel.type=EventType::PointerCancel;cancel.pointerId=entry.first;dispatch(entry.second,cancel);}captures_.clear();parameters_.cancelAll();return;}
 if(e.type==EventType::KeyDown&&e.key=="Tab"){std::vector<Component*> list;focusables(*root_,list);if(!list.empty()){auto i=std::find(list.begin(),list.end(),focused_);int index=i==list.end()?(e.shiftKey?0:-1):int(i-list.begin());focus(list[(index+(e.shiftKey?-1:1)+int(list.size()))%list.size()]);}return;}
 Component* target=nullptr;if(!e.targetId.empty())target=find(*root_,e.targetId);else if(e.type==EventType::KeyDown||e.type==EventType::KeyUp||e.type==EventType::Change||e.type==EventType::Focus)target=focused_;else {auto i=captures_.find(e.pointerId);target=i==captures_.end()?hitTest(e.x,e.y):i->second;}if(e.type==EventType::Focus){focus(target);return;}dispatch(target,e);
}
void Runtime::paintTree(Component& c,Graphics& g,std::vector<std::string>& semantics){if(!c.visible())return;auto b=c.bounds();g.save();g.translate(b.x,b.y);g.clip({0,0,b.width,b.height});c.paint(g);if(c.contentScale()!=1)g.scale(c.contentScale());auto s=c.semantic();if(!s.empty())semantics.push_back(std::move(s));for(auto* child:c.children())paintTree(*child,g,semantics);g.restore();}
void Runtime::frame(double){if(!dirty_)return;dirty_=false;Graphics graphics;std::vector<std::string> semantics;paintTree(*root_,graphics,semantics);std::string tree="{\"version\":1,\"nodes\":[";for(size_t i=0;i<semantics.size();i++){if(i)tree+=',';tree+=semantics[i];}tree+="]}";if(submit_(1,graphics.json())<0||submit_(2,tree)<0)invalidate();}
}
