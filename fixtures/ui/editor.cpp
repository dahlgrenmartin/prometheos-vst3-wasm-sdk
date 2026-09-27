#include <webvst/ui.h>
namespace webvst {
class FixtureEditor : public Component {
  Label title{"title","WebVST native component editor"};
  Slider gain{"gain","Gain"}; Toggle bypass{"bypass","Bypass"};
  ParameterAttachment gainAttachment,bypassAttachment;
public:
  FixtureEditor(Parameters& p):Component("fixture"),gainAttachment(p,7,gain),bypassAttachment(p,8,bypass){addAndMakeVisible(title);addAndMakeVisible(gain);addAndMakeVisible(bypass);}
  void resized()override{title.setBounds({20,12,bounds().width-40,28});gain.setBounds({20,50,bounds().width-40,52});bypass.setBounds({20,120,140,32});}
  void paint(Graphics& g)override{g.rect({0,0,bounds().width,bounds().height},"#141923");}
};
std::unique_ptr<Component> createEditor(Parameters& p){return std::make_unique<FixtureEditor>(p);}
}
