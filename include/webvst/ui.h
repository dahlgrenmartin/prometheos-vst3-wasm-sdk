#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>
namespace webvst {
struct Rect {
  double x=0,y=0,width=0,height=0;
  bool contains(double px,double py) const;
};
enum class EventType { PointerDown, PointerMove, PointerUp, PointerCancel, KeyDown, KeyUp, Wheel, Focus, Blur, Change,
  // Hover tracking (target phase only) and the host's double-click.
  PointerEnter, PointerLeave, DoubleClick };
enum class EventPhase { Capture, Target, Bubble };
struct Event {
  EventType type=EventType::PointerMove; EventPhase phase=EventPhase::Target;
  double x=0,y=0,deltaX=0,deltaY=0,value=0; uint32_t pointerId=0; int button=0;
  std::string key,targetId; bool shiftKey=false,ctrlKey=false,altKey=false,metaKey=false,stopped=false;
  void stopPropagation() { stopped=true; }
};
enum class Align { Left, Center, Right };
class Graphics {
public:
  void save(); void restore(); void clip(Rect); void translate(double,double); void scale(double);
  // Applies to subsequent commands until changed or restored, like juce::Graphics::setOpacity.
  void setOpacity(double); double opacity() const { return opacity_; }
  void transform(double a,double b,double c,double d,double e,double f);
  void rect(Rect,const std::string& color,double radius=0);
  void line(double,double,double,double,const std::string& color,double width=1);
  void strokeRect(Rect,const std::string& color,double lineWidth=1,double radius=0);
  void text(const std::string&,double x,double y,double size,const std::string& color,const std::string& font="sans-serif",Align align=Align::Left);
  void image(const std::string& asset,Rect);
  void path(const std::vector<std::pair<double,double>>&,const std::string& color,bool closed=false);
  void strokePath(const std::vector<std::pair<double,double>>&,const std::string& color,double lineWidth=1,bool closed=false);
  std::string json() const; size_t size() const { return commands_.size(); }
private:
  std::vector<std::string> commands_; std::vector<double> opacities_; double opacity_=1; void add(std::string);
};
class Runtime;
class Component {
public:
  explicit Component(std::string id,std::string label=""); virtual ~Component();
  Component(const Component&)=delete; Component& operator=(const Component&)=delete;
  const std::string& id() const { return id_; } const std::string& label() const { return label_; }
  void setLabel(std::string); void setBounds(Rect); Rect bounds() const { return bounds_; } Rect globalBounds() const;
  // Uniformly scales this component's children (not its own paint), like a JUCE zoom transform.
  void setContentScale(double); double contentScale() const { return scale_; }
  double globalScale() const; void toLocal(double gx,double gy,double& x,double& y) const;
  void addAndMakeVisible(Component&); void removeChild(Component&);
  Component* parent() const { return parent_; } const std::vector<Component*>& children() const { return children_; }
  void setVisible(bool); bool visible() const { return visible_; }
  void setEnabled(bool); bool enabled() const { return enabled_; }
  void setFocusable(bool f) { focusable_=f; } bool focusable() const { return focusable_ && enabled_; }
  bool hasFocus() const; bool isHovered() const; void grabFocus(); void capturePointer(uint32_t); void releasePointer(uint32_t);
  void repaint();
  virtual void paint(Graphics&) {} virtual void resized() {} virtual void onEvent(Event&) {}
  virtual std::string semantic() const { return ""; }
protected:
  Runtime* runtime() const { return runtime_; }
private:
  friend class Runtime;
  std::string id_,label_; Rect bounds_; Component* parent_=nullptr; Runtime* runtime_=nullptr;
  std::vector<Component*> children_; bool visible_=true,enabled_=true,focusable_=false; double scale_=1;
  void connect(Runtime*);
};
// Bounded, strict JSON value: host events and DSP message replies.
struct Json {
  enum Type {Null,Number,String,Boolean,Object,Array} type=Null;
  double number=0; bool boolean=false; std::string string;
  std::map<std::string,Json> object; std::vector<Json> array;
  const Json* get(const char* key) const { auto i=object.find(key); return i==object.end()?nullptr:&i->second; }
  double num(const char* key,double fallback=0) const { auto* v=get(key); return v&&v->type==Number?v->number:fallback; }
  std::string str(const char* key) const { auto* v=get(key); return v&&v->type==String?v->string:""; }
};
// Parses exactly one JSON value spanning the whole input (depth <= 16, bounded node count).
bool parseJson(const char* data,size_t size,Json& out);
std::string jsonQuote(const std::string&);
std::string jsonNumber(double);
// Request/reply channel to this plugin's own DSP (capability dsp.messages/1). Bodies
// are plugin-defined JSON; the host only carries them. Replies arrive asynchronously.
class DspChannel {
public:
  using Reply=std::function<void(bool ok,const Json& body)>;
  using Send=std::function<int(uint32_t id,const std::string& body)>;
  static constexpr size_t kMaxPending=8;
  bool available() const { return available_&&send_!=nullptr; }
  // body is JSON text. False when unavailable or too many requests are pending.
  bool request(const std::string& body,Reply reply);
  size_t pending() const { return pending_.size(); }
  // Runtime side.
  void setSend(Send s) { send_=std::move(s); }
  void setAvailable(bool a) { available_=a; }
  void resolve(uint32_t id,bool ok,const Json& body);
private:
  Send send_; bool available_=false; uint32_t next_=1; std::map<uint32_t,Reply> pending_;
};
struct ProgramCategory { std::string name; std::vector<std::string> programs; };
// Host program (preset) service, negotiated as host.programs/1. The host owns the
// selection: select() is a request and the host publishes the canonical result.
class Programs {
public:
  using Request=std::function<int(int,int)>;
  bool available() const { return !categories_.empty(); }
  const std::vector<ProgramCategory>& categories() const { return categories_; }
  int category() const { return category_; } int program() const { return program_; }
  // Name of the current program, or empty when none is known.
  std::string name() const;
  bool select(int category,int program);
  // Moves by delta through all programs in order, crossing category boundaries.
  bool step(int delta);
  void listen(std::function<void()> f) { listeners_.push_back(std::move(f)); }
  // Runtime side: host publications.
  void setRequest(Request r) { request_=std::move(r); }
  void setCategories(std::vector<ProgramCategory>);
  void publish(int category,int program);
private:
  std::vector<ProgramCategory> categories_; int category_=-1,program_=-1; Request request_;
  std::vector<std::function<void()>> listeners_; void notify();
};
struct ParameterMetadata { uint32_t id=0; double defaultValue=0; uint32_t stepCount=0; bool readOnly=false; std::string name; std::vector<std::string> choices; };
class ParameterAttachment;
class Parameters {
public:
  using Request=std::function<int(int,uint32_t,double)>;
  explicit Parameters(Request request):request_(std::move(request)) {}
  void define(ParameterMetadata); void publish(uint32_t,double); double get(uint32_t) const;
  const ParameterMetadata* metadata(uint32_t) const; void cancelAll();
  // Observes canonical host publications (for view state that follows a parameter).
  void listen(std::function<void(uint32_t,double)> f) { listeners_.push_back(std::move(f)); }
  // Other host services available to the editor.
  Programs& programs() { return programs_; }
  DspChannel& dsp() { return dsp_; }
private:
  Programs programs_; DspChannel dsp_;
  friend class ParameterAttachment;
  Request request_; std::map<uint32_t,double> values_; std::map<uint32_t,ParameterMetadata> metadata_;
  std::vector<ParameterAttachment*> attachments_; std::vector<std::function<void(uint32_t,double)>> listeners_;
};
class ParameterControl : public Component {
public:
  using Component::Component;
  ~ParameterControl() override;
  double value() const { return value_; } void setCanonicalValue(double);
  void onEvent(Event&) override; std::string semantic() const override;
  virtual const char* role() const { return "slider"; }
  virtual double requestedValue(const Event&) const;
protected:
  friend class ParameterAttachment;
  double value_=0; ParameterAttachment* attachment_=nullptr; bool dragging_=false; uint32_t pointer_=0;
};
class ParameterAttachment {
public:
  ParameterAttachment(Parameters&,uint32_t,ParameterControl&); ~ParameterAttachment();
  ParameterAttachment(const ParameterAttachment&)=delete;
  void begin(); void set(double); void end(); uint32_t id() const { return id_; }
  const ParameterMetadata* metadata() const { return parameters_.metadata(id_); }
private:
  friend class Parameters; friend class ParameterControl;
  Parameters& parameters_; uint32_t id_; ParameterControl* control_; bool active_=false;
};
class Slider : public ParameterControl {
public: Slider(std::string id,std::string label=""); void paint(Graphics&) override;
};
class Knob : public Slider { public: using Slider::Slider; void paint(Graphics&) override; };
class Toggle : public Slider {
public: using Slider::Slider; const char* role() const override { return "switch"; }
  double requestedValue(const Event&) const override; void paint(Graphics&) override;
};
class ComboBox : public Slider {
public: using Slider::Slider; const char* role() const override { return "combobox"; }
  void setChoices(std::vector<std::string>); double requestedValue(const Event&) const override;
  void paint(Graphics&) override;
private: std::vector<std::string> choices_;
};
class Label : public Component { public: using Component::Component; void paint(Graphics&) override; std::string semantic() const override; };
class Button : public Component {
public: Button(std::string id,std::string label=""); std::function<void()> onClick;
  void paint(Graphics&) override; void onEvent(Event&) override; std::string semantic() const override;
private: bool pressed_=false; uint32_t pointer_=0;
};
class Runtime {
public:
  using Submit=std::function<int(int,const std::string&)>;
  Runtime(std::unique_ptr<Component>,Parameters&,Submit,std::function<void()> invalidate); ~Runtime();
  Component& root() { return *root_; } void resize(double,double,double); void event(Event);
  void frame(double); void invalidate(); Component* hitTest(double,double) const;
  void focus(Component*); void capture(Component*,uint32_t); void release(Component*,uint32_t);
  void detached(Component*); Component* focused() const { return focused_; } Component* hovered() const { return hovered_; }
private:
  std::unique_ptr<Component> root_; Parameters& parameters_; Submit submit_; std::function<void()> invalidate_;
  Component* focused_=nullptr; Component* hovered_=nullptr; std::map<uint32_t,Component*> captures_; bool dirty_=true;
  void hover(Component*);
  void paintTree(Component&,Graphics&,std::vector<std::string>&); void dispatch(Component*,Event&);
};
// Defined by each UI plugin. Child components remain owned by the editor.
std::unique_ptr<Component> createEditor(Parameters&);
}
