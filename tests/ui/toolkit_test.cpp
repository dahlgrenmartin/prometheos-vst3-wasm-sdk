#include <webvst/ui.h>
#include <cassert>
#include <vector>
using namespace webvst;
struct Trace : Component {
  std::vector<int>& trace; int value;
  Trace(const char* id, std::vector<int>& t, int v):Component(id),trace(t),value(v) {}
  void onEvent(Event& e) override { trace.push_back(value * 10 + int(e.phase)); }
};
int main() {
  std::vector<int> trace, operations;
  Parameters parameters([&](int op,uint32_t,double){ operations.push_back(op);return 0; });
  auto root = std::make_unique<Trace>("root",trace,1);
  Trace child("child",trace,2); child.setBounds({10,10,80,80}); root->addAndMakeVisible(child);
  Runtime runtime(std::move(root),parameters,[](int,const std::string&){return 0;},[]{});
  runtime.resize(100,100,1);
  Event down; down.type=EventType::PointerDown; down.x=20; down.y=20;
  runtime.event(down);
  assert((trace == std::vector<int>{10,21,12}));
  assert(child.globalBounds().x == 10);
  assert(runtime.hitTest(20,20) == &child);
  assert(runtime.hitTest(95,95)->id() == "root");
  Slider slider("gain","Gain"); slider.setBounds({0,0,50,20});
  ParameterAttachment attachment(parameters,7,slider);
  parameters.publish(7,.2); assert(slider.value()==.2);
  attachment.begin(); attachment.set(.9); assert(slider.value()==.2);
  attachment.end(); attachment.end(); assert((operations==std::vector<int>{0,1,2}));
  Graphics graphics; graphics.text("quote\"\n",0,0,12,"#fff");
  assert(graphics.json().find("quote\\\"\\n")!=std::string::npos);
  runtime.root().removeChild(child); assert(child.parent()==nullptr);
  auto temporary=std::make_unique<Slider>("temporary","Temporary");
  auto persistentAttachment=std::make_unique<ParameterAttachment>(parameters,8,*temporary);
  persistentAttachment->begin(); temporary.reset();
  assert(operations.back()==2); // Destroying a control must close and detach its attachment.
  parameters.publish(8,.5); persistentAttachment.reset();
  parameters.define({7,0,4,false,"Gain",{}});
  double requested=-1;
  Parameters stepped([&](int op,uint32_t,double value){if(op==1)requested=value;return 0;});
  stepped.define({7,0,4,false,"Gain",{}});
  Slider steppedControl("stepped"); ParameterAttachment steppedAttachment(stepped,7,steppedControl);
  steppedAttachment.begin(); steppedAttachment.set(.38); steppedAttachment.end(); assert(requested==.5);
  stepped.define({7,0,4,true,"Gain",{}});
  requested=-1; steppedAttachment.begin(); steppedAttachment.set(.5); steppedAttachment.end(); assert(requested==-1);
  Slider captureControl("capture"); captureControl.setBounds({0,0,40,20});
  ParameterAttachment captureAttachment(parameters,9,captureControl); runtime.root().addAndMakeVisible(captureControl);
  down.x=10; down.y=10; down.pointerId=3; runtime.event(down);
  assert(captureControl.hasFocus());
  auto move=down; move.type=EventType::PointerMove; move.x=1000; runtime.event(move);
  assert(operations.back()==1); // Pointer capture continues outside component and editor bounds.
  captureControl.setVisible(false); assert(operations.back()==2); assert(!captureControl.hasFocus());
  auto afterHide=operations.size(); auto cancel=down;cancel.type=EventType::PointerCancel;runtime.event(cancel);assert(operations.size()==afterHide);
  // Content scale maps child geometry, hit testing and local coordinates like a JUCE zoom transform.
  Component zoomed("zoomed"); zoomed.setBounds({10,0,50,50}); zoomed.setContentScale(2);
  Slider inner("inner"); inner.setBounds({5,5,10,10}); zoomed.addAndMakeVisible(inner);
  runtime.root().addAndMakeVisible(zoomed);
  auto g=inner.globalBounds(); assert(g.x==20&&g.y==10&&g.width==20&&g.height==20);
  assert(runtime.hitTest(25,15)==&inner); double lx=0,ly=0; inner.toLocal(30,20,lx,ly); assert(lx==5&&ly==5);
  std::vector<std::pair<uint32_t,double>> heard; parameters.listen([&](uint32_t id,double v){heard.push_back({id,v});});
  parameters.publish(9,.25); assert(heard.size()==1&&heard[0].first==9);
  Graphics faded; faded.save(); faded.setOpacity(.5); faded.rect({0,0,1,1},"#000"); faded.restore(); faded.rect({0,0,1,1},"#000");
  auto json=faded.json(); assert(json.find("\"opacity\":0.5")!=std::string::npos); assert(json.find("opacity")==json.rfind("opacity"));
  // Programs: requests go to the host; only publication changes the selection.
  Programs programs; std::vector<std::pair<int,int>> asked; int heardPrograms=0;
  programs.setRequest([&](int c,int p){asked.push_back({c,p});return 0;}); programs.listen([&]{++heardPrograms;});
  assert(!programs.select(0,0));
  programs.setCategories({{"Basses",{"A","B"}},{"Pads",{"C"}}}); programs.publish(0,1);
  assert(programs.name()=="B"&&heardPrograms==2);
  assert(programs.step(1)&&asked.back()==std::make_pair(1,0)); assert(programs.category()==0);
  programs.publish(0,0); assert(programs.step(-1)&&asked.back()==std::make_pair(1,0));
  assert(!programs.select(1,1)&&!programs.select(2,0));
  // Hover: uncaptured moves track enter/leave; the host's leave clears it; double-click targets the hit.
  struct Hoverable : Component { std::vector<EventType> seen; using Component::Component; void onEvent(Event& e) override { if(e.phase==EventPhase::Target) seen.push_back(e.type); } };
  Hoverable h1("h1"),h2("h2"); h1.setBounds({60,80,10,10}); h2.setBounds({80,80,10,10});
  runtime.root().addAndMakeVisible(h1); runtime.root().addAndMakeVisible(h2);
  Event hm; hm.type=EventType::PointerMove; hm.pointerId=9; hm.x=65; hm.y=85; runtime.event(hm);
  assert(h1.isHovered()&&h1.seen.back()==EventType::PointerMove);
  hm.x=85; runtime.event(hm); assert(!h1.isHovered()&&h2.isHovered());
  assert(std::find(h1.seen.begin(),h1.seen.end(),EventType::PointerLeave)!=h1.seen.end());
  assert(std::find(h2.seen.begin(),h2.seen.end(),EventType::PointerEnter)!=h2.seen.end());
  Event leave; leave.type=EventType::PointerLeave; runtime.event(leave); assert(!h2.isHovered()&&runtime.hovered()==nullptr);
  Event dbl; dbl.type=EventType::DoubleClick; dbl.x=65; dbl.y=85; runtime.event(dbl); assert(h1.seen.back()==EventType::DoubleClick);
  hm.x=65; runtime.event(hm); runtime.root().removeChild(h1); assert(runtime.hovered()==nullptr);
  // JSON and the DSP message channel: bounded requests, replies matched by id.
  auto parse=[](const std::string& t,Json& out){return parseJson(t.data(),t.size(),out);};
  Json parsed; assert(parse("{\"a\":[1,2],\"s\":\"x\"}",parsed)&&parsed.get("a")->array.size()==2&&parsed.str("s")=="x");
  assert(!parse("{\"a\":1} x",parsed));
  DspChannel channel; std::vector<std::string> sent;
  channel.setSend([&](uint32_t id,const std::string& body){sent.push_back(std::to_string(id)+":"+body);return 0;});
  assert(!channel.request("{}",nullptr)); channel.setAvailable(true);
  bool replied=false; assert(channel.request("{\"q\":1}",[&](bool ok,const Json& body){replied=ok&&body.num("v")==7;}));
  Json reply; parse("{\"v\":7}",reply); channel.resolve(99,true,reply); assert(!replied);
  channel.resolve(1,true,reply); assert(replied&&channel.pending()==0&&sent[0]=="1:{\"q\":1}");
  for(size_t i=0;i<DspChannel::kMaxPending;++i)assert(channel.request("{}",nullptr));
  assert(!channel.request("{}",nullptr));
  Graphics aligned; aligned.text("x",0,0,10,"#fff","sans-serif",Align::Right); assert(aligned.json().find("\"align\":\"right\"")!=std::string::npos);
}
