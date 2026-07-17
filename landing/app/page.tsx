import { RevealField } from "@/components/reveal-field";
import { Masthead } from "@/components/sections/masthead";
import { Hero } from "@/components/sections/hero";
import { ProofBand } from "@/components/sections/proof-band";
import { Room } from "@/components/sections/room";
import { Promote } from "@/components/sections/promote";
import { Contested } from "@/components/sections/contested";
import { Slice } from "@/components/sections/slice";
import { Gate } from "@/components/sections/gate";
import { RunTheLoop } from "@/components/sections/run-the-loop";
import { UseGrid } from "@/components/sections/use-grid";
import { Oss } from "@/components/sections/oss";
import { Cloud } from "@/components/sections/cloud";
import { Faq } from "@/components/sections/faq";
import { Finale, Footer } from "@/components/sections/finale";

// The control room, in conversion order: claim, artifact, claim, artifact,
// hands on, then the two asks. Every section performs the product's laws;
// nothing on this page decides without a human.
export default function Page() {
  return (
    <>
      <Masthead />
      <RevealField />
      <main>
        <Hero />
        <ProofBand />
        <Room />
        <Promote />
        <Contested />
        <Slice />
        <Gate />
        <RunTheLoop />
        <UseGrid />
        <Oss />
        <Cloud />
        <Faq />
        <Finale />
      </main>
      <Footer />
    </>
  );
}
