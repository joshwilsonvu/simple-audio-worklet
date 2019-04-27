/**
 * Wraps a frame-based generator, class, or pure function to produce a fast audio worklet.
 */
function simpleAudioWorklet(
  implementation: Implementation,
  {processOnly = false, parameterDescriptors = [], onmessage, registerAs}: SimpleAudioWorkletOptions = {},
): typeof AudioWorkletProcessor {
  class Subclass extends AudioWorkletProcessor {
    next: (args: FrameArgs) => FrameOutput;
    isDone: boolean;
    cleanup?: () => unknown;
    args: FrameArgs;

    constructor(options: AudioWorkletNodeOptions) {
      super(options);
      this.next = this.first; // will be switched after first
      this.isDone = false;
      const outputChannelCount = options.outputChannelCount ? options.outputChannelCount[0] : 2;
      // Because process() is such a hot loop (3ms at 44.1kHz), allocate objects only once to avoid frequent GC.
      this.args = {
        parameters: {},
        input: [],
        port: this.port,
        env: {outputChannelCount, sampleRate}
      };
      this.port.addEventListener('message', e => {
        if (e.data.toString().toLowerCase() === 'stop') {
          this.stop();
        }
      });
      if (onmessage) {
        this.port.addEventListener('message', onmessage);
      }
    }

    static get parameterDescriptors() {
      return implementation.parameterDescriptors || parameterDescriptors;
    }

    /**
     * The main loop.
     *
     * @return {boolean} whether to continue
     */
    process(inputs: Indexable<Indexable<Float32Array>>, outputs: Indexable<Indexable<Float32Array>>, parameters: ProcessParameters) {
      if (this.isDone) {
        throw new RangeError('Attempted to process after iterator has finished.');
      }
      // Adapts for a single-input (optional), single-output processor, which should suit most cases.
      // Each input/output can have multiple channels.
      const input: Indexable<Float32Array> = inputs[0] || []; // empty array if no input
      const output: Indexable<Float32Array> = outputs[0];

      // Most parameters don't need sample-accurate updates, so they are arrays with length 1.
      // Keep track of the ones that do.
      const changed: string[] = [];
      // Initialize the first frame parameters.
      for (let key in parameters) {
        if (parameters.hasOwnProperty(key)) {
          this.args.parameters[key] = parameters[key][0];
          if (parameters[key].length !== 1) {
            changed.push(key);
          }
        }
      }

      // Set "environment" variables for the processor so it doesn't need to use globals.
      // Usually constants but could change
      this.args.env.outputChannelCount = output.length;
      this.args.env.sampleRate = sampleRate;

      // Main loop, always 128 frames
      for (let frame = 0; frame < output[0].length; ++frame) {
        // Update the parameters that have changed, if any.
        for (let key of changed) {
          this.args.parameters[key] = parameters[key][frame];
        }
        // Update the input value, if any, with an array of samples in the single frame.
        for (let channel = 0; channel < input.length; channel++) {
          this.args.input.length = input.length;
          this.args.input[channel] = input[channel][frame];
        }

        // Get the next value, initializing the implementation on its first call.
        let value: FrameOutput = this.next(this.args);
        if (isYieldOutput(value)) {
          // if generator-style return, destructure object
          ({value, done: this.isDone} = value);
        }

        // Signal that the processor is done synthesizing/processing.
        if (this.isDone) {
          this.port.postMessage('done');
          return false; // done, don't continue
        }

        // Accept arrays as mono or multi-channel frames, and numbers as mono frames.
        // If array is not wide enough to fill the output frame, use the first channel as mono.
        if (Array.isArray(value)) {
          if (value.length >= output.length) {
            for (let channel = 0; channel < output.length; ++channel) {
              output[channel][frame] = value[channel];
            }
          } else {
            for (let channel = 0; channel < output.length; ++channel) {
              output[channel][frame] = value[0];
            }
          }
        } else {
          for (let channel = 0; channel < output.length; ++channel) {
            output[channel][frame] = value;
          }
        }

      }
      return !processOnly; // keep alive if synthesizer
    }

    /**
     * On the first frame, determines whether the implementation is an object, class, function, or generator,
     * and sets this.next accordingly. All future frames will call this.next.
     *
     * @param args
     * @return {*}
     * @private
     */
    first(args: FrameArgs) {
      if (implementation.type === 'g') {
        let iterator = implementation.impl(args);
        this.next = iterator.next.bind(iterator);
        this.cleanup = iterator.return && iterator.return.bind(iterator); // for releasing iterator to garbage collector
        return 0; // generators delay frames by one, fill in one frame with a zero
      }
      if (implementation.type === 'p') {
        this.next = implementation.impl;
        return this.next(args);
      }
      if (implementation.type === 'c') {
        let instance = new (implementation.impl)();
        if (instance.next) {
          this.next = instance.next.bind(instance);
          return this.next(args);
        }
      }

      throw new Error('Argument must be a pure function, a generator function, or a class that defines next().');
    }

    stop() {
      this.isDone = true;
      this.cleanup && this.cleanup();
    }
  }

  if (registerAs) {
    registerProcessor(registerAs, Subclass);
  }
  return Subclass;
}

export function fromGenerator(generatorWorklet: GeneratorWorklet, options?: SimpleAudioWorkletOptions) {
  return simpleAudioWorklet({type: 'g', impl: generatorWorklet}, options);
}

export function fromClass(classWorklet: ClassWorklet, options?: SimpleAudioWorkletOptions) {
  return simpleAudioWorklet({type: 'c', impl: classWorklet}, options)
}

export function fromPure(pureWorklet: PureWorklet, options?: SimpleAudioWorkletOptions) {
  return simpleAudioWorklet({type: 'p', impl: pureWorklet}, options);
}

interface SimpleAudioWorkletOptions {
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

interface ProcessParameters {
  [param: string]: Float32Array
}

interface FrameArgs {
  // An array containing the sample value for each input channel.
  input: number[],
  // An object of the parameters declared in parameterDescriptors and their corresponding values.
  readonly parameters: {
    [param: string]: number
  },
  // A port usable for communication with the paired AudioWorkletNode.
  readonly port: MessagePort,
  // An "environment" containing useful values. These values can change but usually won't.
  readonly env: {
    outputChannelCount: number,
    sampleRate: number
  }
}

type FrameOutput = Output | YieldOutput;
type Output = number | number[];
type YieldOutput = { value: Output, done: boolean };

interface ClassWorklet {
  new(): {
    next: (args?: FrameArgs) => FrameOutput
  }
}

interface ClassImpl {
  type: 'c',
  impl: ClassWorklet
}

interface GeneratorWorklet {
  (args: FrameArgs): Generator,

  return: (value?: any) => unknown
}

interface GeneratorImpl {
  type: 'g',
  impl: GeneratorWorklet
}

interface PureWorklet {
  (args: FrameArgs): FrameOutput
}

interface PureImpl {
  type: 'p',
  impl: PureWorklet
}

interface SharedImpl {
  parameterDescriptors?: Array<AudioParamDescriptor>,
}

type Implementation = (ClassImpl | GeneratorImpl | PureImpl) & SharedImpl;

interface Indexable<T> {
  [index: number]: T,

  readonly length: number,
}

function isYieldOutput(value: FrameOutput): value is YieldOutput {
  return Object.prototype.hasOwnProperty.call(value, 'value');
}

// declarations, remove once TS adds them
declare class AudioWorkletProcessor {
  constructor(options?: AudioWorkletNodeOptions);

  readonly port: MessagePort;

  process(inputs: Indexable<Indexable<Float32Array>>, outputs: Indexable<Indexable<Float32Array>>, parameters: ProcessParameters): void;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

declare var sampleRate: number;