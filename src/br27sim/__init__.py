"""BR27 electrical system simulator (Bobcat Racing, FSAE 2027).

Models the 2012 CBR600RR + EMU Black, the 12 V system through an endurance run,
the IC.9 shutdown circuit, the CAN bus and the DAQ, plus the powertrain harness.

    import br27sim
    lap = br27sim.simulate_lap({"finalDrive": 3.5})
    print(lap["stats"]["lapTime"])
"""
from .can import (BUS_INFO, CAN_LAYOUTS, arbitrate, can_messages, can_physical, frame_bits, frame_time,
                  simulate_can, simulate_can_all)
from .daq import alias_demo
from .engine import FIRING_ORDER, engine_model, firing_events, simulate_lap
from .faults import FAULT_BANDS, FAULTS, fault_logic, simulate_fault
from .params import BATTERIES, DEFAULTS, TRACK, with_defaults
from .power import simulate_crank, simulate_power
from .shutdown import SHUTDOWN_SWITCHES, shutdown_state, simulate_shutdown

__version__ = "0.1.0"

# The browser page calls the model by its original JavaScript names.
JS_API = {
    "withDefaults": with_defaults,
    "simulateLap": simulate_lap,
    "simulatePower": simulate_power,
    "simulateCrank": simulate_crank,
    "firingEvents": firing_events,
    "simulateShutdown": simulate_shutdown,
    "shutdownState": shutdown_state,
    "frameTime": frame_time,
    "frameBits": frame_bits,
    "canMessages": can_messages,
    "simulateCan": simulate_can,
    "simulateCanAll": simulate_can_all,
    "canPhysical": can_physical,
    "aliasDemo": alias_demo,
    "faultLogic": fault_logic,
    "simulateFault": simulate_fault,
    "arbitrate": arbitrate,
}
