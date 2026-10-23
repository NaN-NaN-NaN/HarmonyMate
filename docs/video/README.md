# Screenshot walkthrough

`build_walkthrough.py` creates a 1920×1080 MP4, English SRT subtitles and a storyboard using the project screenshots, Pillow, macOS `say` (Samantha), ffmpeg and ffprobe. No cloud credentials are needed.

```sh
python3 docs/video/build_walkthrough.py /absolute/output/directory
```

The approximately 2:08 presentation is explicitly labeled as a screenshot walkthrough with synthetic narration and a simulated Alexa+ interface. It includes no recorded singing or audible harmony demonstration. It should be complemented by a live recording with an original sung phrase before serving as the sole hackathon demo. The MP4 can be uploaded to a video host; generating it does not publish it or submit the Devpost entry.

The compact final MP4 and SRT are included in this directory for judges. Intermediate images and audio should stay outside the source checkout. The English narration is defined in the script and can be revised before rendering.
