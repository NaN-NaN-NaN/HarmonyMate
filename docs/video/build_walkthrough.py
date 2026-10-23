"""Build an honest screenshot walkthrough with local macOS narration.
Requires Pillow, macOS say, ffmpeg and ffprobe. No cloud services are used.
Usage: python3 docs/video/build_walkthrough.py /absolute/output/directory
"""
from pathlib import Path
import json, subprocess, sys, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'artifacts/video'
OUT.mkdir(parents=True, exist_ok=True)
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
SERIF='/System/Library/Fonts/Supplemental/Georgia.ttf'
SCENES=[
('01 / THE IDEA','A little voice.\nA shared moment.', ['A conversational singing studio','Sing → review → harmonize → mix'], 'hackathon-cover', [
'HarmonyMate turns a short sung phrase into something you can make together and give to someone you love.',
'This is a screenshot walkthrough of the working browser prototype, with a simulated Alexa Plus experience.']),
('02 / SING & REVIEW','Keep the take\nyou choose.', ['Sing freely for up to 30 seconds','Listen, keep, retry or discard','Kept versions stay safe'], 'free-singing-review', [
'Start with your own unaccompanied phrase. After recording, listen to the preview and choose to keep it, sing again, or discard it.',
'A pending take never replaces a kept version. Recording does not automatically mean approval or sharing.']),
('03 / CREATE HARMONIES','Your voice,\nwith harmony.', ['Higher or lower','Thirds · fifths · sixths','Each part gets its own track'], 'free-harmony-result', [
'Choose higher or lower thirds, fifths, or sixths. Each generated harmony becomes an independent numbered track.',
'The engine estimates pitch and key, then processes the recorded voice locally with ffmpeg. This is digital signal processing, not an AI singer.']),
('04 / CHOOSE YOUR MIX','Every voice.\nIts own track.', ['Listen to individual tracks','Select up to eight together','Adjust volume and timing'], 'multitrack-studio', [
'Listen to a track alone, or select up to eight tracks to hear together. Adjust their volume and timing, then save that exact combination as a mix.',
'Stable track numbers also make conversational requests easier to understand.']),
('05 / ADD A HUMAN VOICE','Listen.\nSing together.', ['Choose the reference tracks','Wear headphones','Review and keep the new voice'], 'multitrack-overdub', [
'To sing a real human harmony, select the tracks you want to hear and put on headphones.',
'Record while those references play. The microphone is captured separately. Review and keep the new voice as another track.']),
('06 / CONVERSATIONAL MCP','Ask for the\ntracks you want.', ['“What tracks do I have?”','“Play tracks 1 and 3.”','“Sing with track 1.”'], None, [
'Ask what tracks are available, play tracks one and three, or sing with track one. Common Chinese requests work too.',
'Thirteen tools cross a real authenticated HTTP MCP boundary. Alexa Plus is simulated in the browser; there is no live Echo microphone connection.']),
('07 / A MUSICAL GIFT','Make something\nworth keeping.', ['Save one particular mix','Review the recipient and note','Confirm before sharing'], 'recipient', [
'Save a mix as a musical gift. Review the recipient, note, and fixed version before confirming.',
'The recipient can play it in a demo inbox. Later retakes do not change a gift that was already shared.']),
('08 / BUILT & NEXT','Working locally.\nReady to explore.', ['React · TypeScript · Web Audio','Express · SQLite · ffmpeg · MCP','Next: listening tests with singers'], None, [
'The prototype implements recording, independent tracks, harmony processing, mixing, persistent storage, and confirmed gifts.',
'Next come listening tests with singers, improved timbre, and official Alexa Plus onboarding. Hardware latency and live Bedrock use are not verified.']),
('09 / TRY HARMONYMATE','Sing a little.\nHear the harmony.', ['Public source and setup instructions','No AWS account needed for the demo','github.com/NaN-NaN-NaN/HarmonyMate'], 'hackathon-cover', [
'Try HarmonyMate from the public repository. The README includes setup, tests, and the limits of the demo.',
'Sing a little. Hear the harmony. Make it together.'])]

def run(args): subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def font(size, serif=False): return ImageFont.truetype(SERIF if serif else FONT,size)
def wrap(draw,text,f,maxwidth):
 result=[]
 for paragraph in text.split('\n'):
  line=''
  for word in paragraph.split():
   test=(line+' '+word).strip()
   if draw.textlength(test,font=f)>maxwidth and line: result.append(line); line=word
   else: line=test
  result.append(line)
 return result

def frame(scene,index,caption=None,cue_index=0):
 kicker,title,bullets,asset,cues=scene
 im=Image.new('RGB',(1920,1080),'#f6f4ed'); d=ImageDraw.Draw(im)
 d.ellipse((1450,-280,2150,420),fill='#e9ece2')
 d.text((90,58),'harmonymate.',font=font(43),fill='#8e5844')
 d.text((90,148),kicker,font=font(24),fill='#6b736b')
 y=220
 for line in title.split('\n'):
  d.text((88,y),line,font=font(68,True),fill='#252e29'); y+=88
 y+=38
 for bullet in bullets:
  for line in wrap(d,bullet,font(29),570):
   d.text((95,y),line,font=font(29),fill='#565e56'); y+=44
  y+=25
 if asset:
  shot=Image.open(ROOT/'docs/screenshots'/(asset+'.jpg')).convert('RGB')
  shot.thumbnail((1050,650),Image.Resampling.LANCZOS)
  x=735+(1080-shot.width)//2; sy=160+(670-shot.height)//2
  d.rounded_rectangle((x-15,sy-15,x+shot.width+15,sy+shot.height+15),radius=22,fill='#e6e5dd')
  im.paste(shot,(x,sy))
 else:
  x,y=790,195
  if index==5:
   for j,text in enumerate(['You: “Play tracks 1 and 3.”','Browser simulator → MCP client','Authenticated HTTP → 13 tools','Track inventory · playback · jobs']):
    d.rounded_rectangle((x,y,x+1000,y+105),radius=23,fill=['#e9dfd5','#e3e8dc','#e7e3ea','#e3e8dc'][j])
    d.text((x+32,y+31),text,font=font(32),fill='#303b32'); y+=139
  else:
   for j,(a,b) in enumerate([('IMPLEMENTED','Recording • tracks • harmonies • gifts'),('SIMULATED','Alexa+ interface • demo identities'),('NEXT','Voice quality • latency • official access')]):
    d.rounded_rectangle((x,y,x+1000,y+150),radius=25,fill=['#e3e8dc','#e7e3ea','#e9dfd5'][j])
    d.text((x+30,y+22),a,font=font(24),fill='#786657'); d.text((x+30,y+76),b,font=font(30),fill='#303b32'); y+=180
 d.rectangle((0,868,1920,1080),fill='#26382f')
 d.text((90,892),'SCREENSHOT WALKTHROUGH  ·  Simulated Alexa+  ·  Synthetic narration',font=font(20),fill='#c9d0c7')
 d.text((1770,892),f'{index+1:02d} / 09',font=font(20),fill='#c9d0c7')
 if caption:
  lines=wrap(d,caption,font(39),1690)
  cy=951 if len(lines)<=2 else 929
  for line in lines:
   d.text(((1920-d.textlength(line,font=font(39)))//2,cy),line,font=font(39),fill='#ffffff'); cy+=48
 path=OUT/f'scene-{index+1:02d}-{cue_index}.png'; im.save(path); return path

def timestamp(t):
 ms=round(t*1000); return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'

elapsed=0.; subtitles=[]; clips=[]; storyboard=[]
for i,scene in enumerate(SCENES):
 image=frame(scene,i); voiceparts=[]; durations=[]
 for j,cue in enumerate(scene[4]):
  txt=OUT/f'narration-{i+1:02d}-{j+1}.txt'; txt.write_text(cue+'\n')
  audio=OUT/f'narration-{i+1:02d}-{j+1}.aiff'
  if not audio.exists(): run(['say','-v','Samantha','-r','155','-f',str(txt),'-o',str(audio)])
  duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(audio)]))
  durations.append(duration); voiceparts.append(audio)
  subtitles.append((elapsed+0.25,elapsed+duration+0.25,cue)); elapsed+=duration+0.5
 audio_list=OUT/f'audio-{i+1:02d}.txt'
 # Add a half-second pause after each narration cue.
 padded=[]
 for j,a in enumerate(voiceparts):
  p=OUT/f'voice-{i+1:02d}-{j+1}.wav'
  run(['ffmpeg','-y','-i',str(a),'-af','apad=pad_dur=0.5,adelay=250|250','-t',str(durations[j]+.5),'-ar','48000','-ac','1',str(p)]); padded.append(p)
 audio_list.write_text(''.join(f"file '{p}'\n" for p in padded))
 audio=OUT/f'scene-{i+1:02d}.wav'; run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(audio_list),'-c','copy',str(audio)])
 duration=sum(durations)+len(durations)*.5
 for j,cue in enumerate(scene[4]):
  caption_frame=frame(scene,i,cue,j+1); clip=OUT/f'captioned-{i+1:02d}-{j+1}.mp4'
  run(['ffmpeg','-y','-loop','1','-framerate','24','-i',str(caption_frame),'-i',str(padded[j]),'-t',str(durations[j]+.5),'-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',str(clip)])
  clips.append(clip)
 storyboard.append({'scene':i+1,'title':scene[1].replace('\n',' '),'duration':round(duration,2),'narration':scene[4]})
 print(f'Scene {i+1}/9 encoded ({duration:.1f}s)',flush=True)

srt=OUT/'HarmonyMate-walkthrough.en.srt'
srt.write_text('\n\n'.join(f'{i+1}\n{timestamp(a)} --> {timestamp(b)}\n'+textwrap.fill(t,width=92) for i,(a,b,t) in enumerate(subtitles))+'\n')
concat=OUT/'clips.txt'; concat.write_text(''.join(f"file '{p}'\n" for p in clips))
final=OUT/'HarmonyMate-walkthrough.mp4'
run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy','-movflags','+faststart',str(final)])
(OUT/'storyboard.json').write_text(json.dumps(storyboard,indent=2))
(OUT/'README.txt').write_text('HarmonyMate screenshot walkthrough\n1920x1080, English burned-in captions and local synthetic Samantha narration.\nThis is an edited screenshot presentation, not a continuous recording or proof of real Alexa hardware.\nNo actual singing or generated harmony is audible. Record a live audio demonstration before using this as the sole hackathon demo.\nSource: '+str(ROOT)+'\n')
print(json.dumps({'video':str(final),'duration_seconds':elapsed,'subtitles':str(srt)},indent=2))
