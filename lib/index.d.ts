export declare function fromGenerator(generatorWorklet: GeneratorWorklet, options?: SimpleAudioWorkletOptions): typeof AudioWorkletProcessor;
export declare function fromClass(classWorklet: ClassWorklet, options?: SimpleAudioWorkletOptions): typeof AudioWorkletProcessor;
export declare function fromPure(pureWorklet: PureWorklet, options?: SimpleAudioWorkletOptions): typeof AudioWorkletProcessor;
interface SimpleAudioWorkletOptions {
    processOnly?: boolean;
    parameterDescriptors?: AudioParamDescriptor[];
    onmessage?: (this: MessagePort, ev: MessageEvent) => any;
    registerAs?: string;
}
interface ProcessParameters {
    [param: string]: Float32Array;
}
interface FrameArgs {
    input: number[];
    readonly parameters: {
        [param: string]: number;
    };
    readonly port: MessagePort;
    readonly env: {
        outputChannelCount: number;
        sampleRate: number;
    };
}
declare type FrameOutput = Output | YieldOutput;
declare type Output = number | number[];
declare type YieldOutput = {
    value: Output;
    done: boolean;
};
interface ClassWorklet {
    new (): {
        next: (args?: FrameArgs) => FrameOutput;
    };
}
interface GeneratorWorklet {
    (args: FrameArgs): Generator;
    return: (value?: any) => unknown;
}
interface PureWorklet {
    (args: FrameArgs): FrameOutput;
}
interface Indexable<T> {
    [index: number]: T;
    readonly length: number;
}
declare class AudioWorkletProcessor {
    constructor(options?: AudioWorkletNodeOptions);
    readonly port: MessagePort;
    process(inputs: Indexable<Indexable<Float32Array>>, outputs: Indexable<Indexable<Float32Array>>, parameters: ProcessParameters): void;
}
export {};
