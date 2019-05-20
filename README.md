# Simple Audio Worklet

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Size](https://img.badgesize.io/joshwilsonvu/simple-audio-worklet/master/lib/index.min.js?compression=gzip)
[![Issues](https://img.shields.io/github/issues/joshwilsonvu/simple-audio-worklet.svg)](https://github.com/joshwilsonvu/simple-audio-worklet/issues)
[![npm version](https://badge.fury.io/js/simple-audio-worklet.svg)](https://badge.fury.io/js/simple-audio-worklet)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Table of Contents
=================

* [Usage](#usage)
  * [Generator function](#generator-function)
  * [Class](#class)
  * [Pure function](#pure-function)
* [Installation](#installation)
  * [ES6 Module](#es6-module)
  * [Webpack](#webpack)


Audio Worklets handle audio in blocks of 128 frames at a time,
provide parameters that can be arrays of either one or 128 values,
and make setup that depends on parameters difficult.

This package abstracts the complexity and focuses on the actual
processing, one frame at a time. It works with generator functions,
classes, and pure functions, and produces efficient code that does not
even allocate any memory after initialization.

If you are not already familiar with using Audio Worklets, see
[this article](https://developers.google.com/web/updates/2017/12/audio-worklet).


## Usage

Whether a generator function, class, or pure function, use this package
like this:

```javascript
import { fromGenerator, fromClass, fromPure } from 'simple-audio-worklet';
let processor = fromOneOfTheAbove(yourImplementation, options);
```

where options looks like the following:

```typescript
{
  // If true, stops running the worklet if there are no input nodes connected.
  processOnly?: boolean,
  // An array of descriptors describing the parameters this worklet
  // takes. These correspond to the parameters sent to the implementation.
  parameterDescriptors?: AudioParamDescriptor[],
  // Handles incoming messages from the paired AudioWorkletNode.
  onmessage?: (this: MessagePort, ev: MessageEvent) => any,
  // If a non-empty string, calls registerProcessor(...) on the generated class.
  registerAs?: string
}
```

The implementation will be called each frame with `args` as follows:

```typescript
{
  // An array containing the sample value for each input channel.
  // Empty if not connected.
  input: number[],
  // An object of the parameters declared in parameterDescriptors
  // and their corresponding values.
  readonly parameters: {
    [param: string]: number
  },
  // A port usable for communication with the paired AudioWorkletNode.
  readonly port: MessagePort,
  // An "environment" containing useful values. These values can
  // change but usually won't.
  readonly env: {
    outputChannelCount: number,
    sampleRate: number
  }
}
```

and expected to return either a `number` or a `Float32Array`.

A returned `Float32Array` will map one-to-one with the output frame
channels, if it is long enough. If not, the first value of the array
will be treated as a returned number.

A returned `number` will be treated as a mono frame, and will
be copied to all output channels.

### Generator function
Generator functions work as straightforward representations of
asynchronous processing, which makes them well suited to audio
processing applications. Most cases will involve an infinite
loop with all processing done inside, and optional setup done
beforehand.

For many cases, a generator function is the most
readable and writable way to express a DSP algorithm.

```javascript
import { fromGenerator } from 'simple-audio-worklet';

function* addNoise({parameters, input, port}) {
  // setup would go here
  for (;;) {
    let {gain} = parameters; // or just use parameters.gain
    for (let channel = 0; channel < input.length; ++channel) {
      let noise = (Math.random() * 2 - 1) * gain;
      input[channel] += noise; // Safe and faster to modify input in place
    }
    yield input;
  }
}
let processor = fromGenerator(addNoise, {
  processOnly: true,
  parameterDescriptors: [{
    name: 'gain',
    minValue: 0,
    maxValue: 1,
    defaultValue: 0.5
  }]
});
```

#### Notes
1. Because of the nature of generators, there is a one-frame delay on
the output, which may not be suitable for some cases. The very first
frame is zero-filled.

2. The identity of `args`, `args.parameters`, `args.input`, `args.port`,
and `args.env` is guaranteed not to change. Therefore, it is okay to use
 ```javascript
yield x;
 ```

 whereas otherwise one would have to use

 ```javascript
({parameters, input} = yield x);
 ```

 *However*, the values for the individual parameters must be accessed on the parameters
 object or updated every yield, or else the values will become outdated. For example,
 ```javascript
function* process({parameters, input, port}) {
  let {param} = parameters; // BAD, will go stale
  for (;;) {
    let {param} = parameters; // OK
    ... parameters.param ...; // OK
    // compute something as result
    yield result;
  }
}
 ```

3.  Some browsers do not garbage collect abandoned generator functions
in their paused state. Thus, posting the string `"stop"` to the
`AudioWorkletProcessor` from the corresponding `AudioWorkletNode` will force
the generator function to return, useful if using many instances.

### Class

The class version looks similar to the standards-compliant processor,
but with frame-based processing as opposed to block-based processing.
It must define a next() method instead of a process() method, and the
parameters differ. It may be more familiar to object oriented
programmers than the generator function, has no frame delay, and can
use state.

```javascript
import { fromClass } from 'simple-audio-worklet';

class AddNoise {
  constructor({parameters, input, port}) {
    // Initialize some instance variables,
    // same arguments as on first call to next()
  }

  next({parameters, input, port}) {
    for (let channel = 1; channel < input.length; ++channel) {
      let noise = (Math.random() * 2 - 1) * parameters.gain;
      input[channel] += noise;
    }
    return input;
  }
}

let processor = fromClass(AddNoise, {
  processOnly: true,
  parameterDescriptors: [{
    name: 'gain',
    minValue: 0,
    maxValue: 1,
    defaultValue: 0.5
  }]
});
```


### Pure function

The pure function implementation is best when no state is necessary.
Every output frame should be based solely on the frame input and the
parameters, not on previous frames.

```javascript
import { fromPure } from 'simple-audio-worklet';

function addNoise({parameters, input, port}) {
  for (let channel = 1; channel < input.length; ++channel) {
    let noise = (Math.random() * 2 - 1) * parameters.gain;
    input[channel] += noise;
  }
  return input;
}

let processor = fromPure(addNoise, {
  processOnly: true,
  parameterDescriptors: [{
    name: 'gain',
    minValue: 0,
    maxValue: 1,
    defaultValue: 0.5
  }]
});
```

It is important to keep this function pure in the sense that
it does not store information by capturing variables and writing
to them; alternatively, we can say the function must be memoryless.
This limitation is in place because multiple instances of the processor
would be capturing the same variables, leading to unexpected results.
Capturing a constant value is fine.

## Installation

```bash
$ npm install simple-audio-worklet
```

Typescript type definitions are bundled with this package.

### ES6 Module
In Chromium and potentially other browsers, worklets can
[now use](https://chromium-review.googlesource.com/c/chromium/src/+/627543)
standard ES6 module loading. This means this package can be included into
browser code with something like

```html
<script
   src="simple-audio-worklet.js"
   type="module">
</script>
```

where `simple-audio-worklet.js` has been copied from
`/node_modules/simple-audio-worklet/lib/index.js` and then running

```javascript
let context = new AudioContext();
await context.audioWorklet.addModule("my-audio-worklet.js");
```

with `my-audio-worklet.js` containing

```javascript
import { fromGenerator, fromClass, fromPure } from 'simple-audio-worklet';
```

### Webpack
Packing files in worklet global scopes with packages like
[worklet-loader](https://github.com/reklawnos/worklet-loader) may work
but is still relatively immature at time of writing.

